#!/usr/bin/env node
/**
 * backfill-audit-tiers.mjs — auto-seed the `Audit Tiers` token column into the
 * three audit trackers (project_critical_flows / project_feature_audits /
 * project_ops_register).
 *
 * STATUS: ONE-SHOT. The initial backfill already ran (2026-06-19, ~113 tokens) —
 * this is NOT part of the live `/flows`·`/features`·`/ops` pipeline. New audit
 * tokens are HAND-STAMPED on each audit close (stamp-on-audit), not
 * re-derived here. Kept (migration-script precedent) for two residual uses only:
 * (a) seed a NEWLY-ADDED tracker — it SKIPs tables that already have an `Audit
 * Tiers` column, so a re-run is safe; (b) `--dry-run`/`--json` a DRIFT check of the
 * hand-stamped tokens against the heuristic. If neither applies, do not run it.
 *
 * TEST COVERAGE: intentionally NONE (won't-fix).
 * The splice core (unescapedPipePositions / cellsOf / insertAfterStatus) was VERIFIED
 * byte-exact + idempotent via a dry-run over the already-seeded trackers this session,
 * and this is a dead-after-run migration-class one-shot. REVISIT only at residual use
 * (a): before seeding a
 * brand-new tracker (the lone splice-MUTATING re-run), FIRST make this import-safe (CLI
 * guard + export the splice fns) and add ~6 unit tests over the escaped-`\|` byte
 * preservation — that is the moment the coverage earns its keep, not now.
 *
 * WHAT IT DOES
 *   For every table that has a `Status` header cell AND ≥1 id-row (Flow# / F# /
 *   O#), it inserts a NEW `Audit Tiers` column IMMEDIATELY AFTER `Status`
 *   (header cell + separator `---` + per-row token), schema-aware per sub-table.
 *   Every existing column + all cell prose is preserved BYTE-FOR-BYTE — the
 *   insertion is a pure string-splice after the (Status+1)-th unescaped pipe; no
 *   split/rejoin of the row (so escaped `\|` inside prose is never disturbed).
 *
 * TOKEN GRAMMAR — space-separated key:value, value is always \S+:
 *   flows + features:  v1:YYYY-MM-DD v2:YYYY-MM-DD v3:YYYY-MM-DD v4:YYYY-MM-DD c:YYYY-MM-DD
 *   ops:               prov:<YYYY-MM-DD | via-F17 | via-Flow#1>  c:YYYY-MM-DD
 *   never-audited row → literally `—`
 *
 * DERIVATION HEURISTIC — the seed is a PROPOSAL, not ground truth:
 *   v1   = latest ISO date in the Initial-Audit / Audit column (the col right
 *          after Status).
 *   v2/v3/v4/c = ISO dates in the Final-Audit narrative, keyword-ANCHORED:
 *            final-audit / v2          → v2
 *            v3 / drift / re-audit / redo → v3
 *            v4                        → v4  (added 2026-09-22 with the tier —
 *                                        a "v4 re-audit" is claimed by BOTH v3
 *                                        and v4 and lands in the AMBIGUOUS
 *                                        list, which is the right answer: that
 *                                        exact phrase was stamped v3 when no
 *                                        v4 slot existed)
 *            --code                    → c
 *          (a tier keyword "claims" the nearest ISO date in a tight window; the
 *           latest claimed date per tier wins. Stray dates with no nearby tier
 *           keyword — commit/migration/reference dates — are intentionally NOT
 *           classified.) A date claimed by >1 tier class is AMBIGUOUS → assigned
 *           to the nearest keyword + the row is FLAGGED for human spot-check.
 *   ops prov = the Audited? column's own audit date when an audit-performed verb
 *          is present; else the inherited `via-<F#|Flow#|O#>` it cites; else `—`.
 *
 * USAGE
 *   node scripts/backfill-audit-tiers.mjs            # writes the 3 files + prints review
 *   node scripts/backfill-audit-tiers.mjs --dry-run  # prints review only, writes nothing
 *   node scripts/backfill-audit-tiers.mjs --json      # machine-readable review (implies dry-run)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { trackerFiles } from "./lib/tracker-shards.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEM = ".claude/project-memory";

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const DRY = args.has("--dry-run") || JSON_OUT;

const FILES = [
  { tracker: "flows", file: `${MEM}/project_critical_flows.md`, idRe: /^\s*\|\s*\d+\s*\|/ },
  { tracker: "features", file: `${MEM}/project_feature_audits.md`, idRe: /^\s*\|\s*F\d+\s*\|/ },
  { tracker: "ops", file: `${MEM}/project_ops_register.md`, idRe: /^\s*\|\s*O\d+\s*\|/ },
];

const ISO = /\b20\d\d-\d\d-\d\d\b/g;
const SEP_RE = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/; // a markdown header-separator row

// ---- pipe handling (markdown-correct: `\|` is escaped, not a delimiter) ----
function unescapedPipePositions(line) {
  const pos = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "|") continue;
    let bs = 0, j = i - 1;
    while (j >= 0 && line[j] === "\\") { bs++; j--; }
    if (bs % 2 === 0) pos.push(i); // even (incl. 0) preceding backslashes ⇒ real delimiter
  }
  return pos;
}
// logical cells between the leading and trailing pipe (mirrors how the row reads)
function cellsOf(line) {
  const p = unescapedPipePositions(line);
  if (p.length < 2) return [];
  const out = [];
  for (let i = 0; i < p.length - 1; i++) out.push(line.slice(p[i] + 1, p[i + 1]));
  return out;
}
// splice ` <fill> |` (or `---|` for separators) in right after the (S+1)-th pipe.
function insertAfterStatus(line, statusIdx, fill, isSep) {
  const p = unescapedPipePositions(line);
  const at = p[statusIdx + 1]; // pipe that closes the Status cell
  if (at == null) return null; // row has too few pipes — caller flags
  const ins = isSep ? `${fill}|` : ` ${fill} |`;
  return line.slice(0, at + 1) + ins + line.slice(at + 1);
}

// ---- date / keyword classification ----
const TIER_KW = {
  v2: [/\bfinal[-\s]audits?\b/gi, /\bv2\b/gi],
  v3: [/\bv3\b/gi, /\bdrift\b/gi, /\bre-?audits?\b/gi, /\bredo\b/gi],
  v4: [/\bv4\b/gi],
  c: [/--code\b/gi],
};
const AFTER = 46, BEFORE = 16; // window: a tier keyword claims an ISO date in [kwStart-BEFORE, kwEnd+AFTER]

// Returns { perTier: {v2:[{date,kw,pos}],...}, ambiguous:[{date,tiers}], allDates:[...] }
function classifyNarrative(text) {
  const allDates = [...text.matchAll(ISO)].map((m) => ({ date: m[0], pos: m.index }));
  // claims[datePos] = [{tier, kw, dist}]
  const claims = new Map();
  for (const [tier, regexes] of Object.entries(TIER_KW)) {
    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const kwStart = m.index, kwEnd = m.index + m[0].length;
        // nearest ISO date inside the window
        let best = null;
        for (const d of allDates) {
          const inWin = d.pos >= kwStart - BEFORE && d.pos <= kwEnd + AFTER;
          if (!inWin) continue;
          const dist = d.pos >= kwEnd ? d.pos - kwEnd : (d.pos <= kwStart ? kwStart - d.pos : 0);
          if (!best || dist < best.dist) best = { d, dist };
        }
        if (best) {
          const arr = claims.get(best.d.pos) || [];
          arr.push({ tier, kw: m[0], dist: best.dist, date: best.d.date });
          claims.set(best.d.pos, arr);
        }
        if (m[0].length === 0) re.lastIndex++; // guard zero-width
      }
    }
  }
  const perTier = { v2: [], v3: [], v4: [], c: [] };
  const ambiguous = [];
  for (const [, arr] of claims) {
    const tiers = [...new Set(arr.map((a) => a.tier))];
    arr.sort((a, b) => a.dist - b.dist);
    const winner = arr[0];
    perTier[winner.tier].push({ date: winner.date, kw: winner.kw, dist: winner.dist });
    if (tiers.length > 1) {
      ambiguous.push({ date: winner.date, chosen: winner.tier, kws: arr.map((a) => `${a.tier}:${a.kw}@${a.dist}`) });
    }
  }
  return { perTier, ambiguous, allDates: allDates.map((d) => d.date) };
}
const latest = (dates) => (dates.length ? dates.slice().sort().at(-1) : null);
const latestDateIn = (text) => latest([...String(text).matchAll(ISO)].map((m) => m[0]));

// ---- ops provenance ----
const AUDIT_VERB = /(panel-audited|final[-\s]audit|complete\b|\d+-expert|expert full audit|expert lean panel|\/audit-check|audited\b)/i;
const VIA_REF = /\b(F\d+|O\d+|Flow\s*#?\s*\d+)\b/i;
function deriveProv(auditedCell) {
  const cell = String(auditedCell);
  const hasDate = latestDateIn(cell);
  const viaCtx = /\b(shipped|covered|inherits?|partial)\b[^.]*?\bvia\b|\bvia\b/i.test(cell);
  const refMatch = cell.match(VIA_REF);
  const ref = refMatch ? "via-" + refMatch[1].replace(/Flow\s*#?\s*/i, "Flow#").replace(/\s+/g, "") : null;
  // audit-performed ON this entry (independent) vs merely shipped-via a parent (inherited)
  if (hasDate && AUDIT_VERB.test(cell) && !/^\s*(shipped|covered)\b/i.test(cell)) {
    return { prov: hasDate, kind: "independent", coDate: !!ref };
  }
  if (viaCtx && ref) return { prov: ref, kind: "inherited", coDate: !!hasDate };
  if (hasDate) return { prov: hasDate, kind: "independent", coDate: !!ref };
  if (ref) return { prov: ref, kind: "inherited", coDate: false };
  return { prov: null, kind: "none", coDate: false };
}

const isComplete = (status) => /COMPLETE|SHIPPED/i.test(status);
function buildToken(parts, order) {
  const s = order.filter((k) => parts[k]).map((k) => `${k}:${parts[k]}`).join(" ");
  return s || "—";
}

// =================== per-file processing ===================
function processFile(spec) {
  const abs = join(ROOT, spec.file);
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split("\n");
  const review = []; // {id, token, flags:[], dbg:{}}
  const tableLog = [];
  let changed = 0;

  // First pass: discover tables (header line + separator line + data line indices).
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i];
    if (!/^\s*\|/.test(l) || SEP_RE.test(l)) continue;
    if (!SEP_RE.test(lines[i + 1] || "")) continue; // header iff next line is a separator
    // collect data rows: subsequent |-rows (blank lines allowed inside, e.g. flows
    // coverage-gap) until a markdown heading or a non-blank non-pipe (prose) line.
    const dataIdx = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const d = lines[j];
      if (d.trim() === "") continue;            // blank: stays inside the table
      if (/^\s*#{1,6}\s/.test(d)) break;         // new heading ends the table
      if (SEP_RE.test(d)) break;                 // another separator ends it
      if (!/^\s*\|/.test(d)) break;              // prose ends the table
      dataIdx.push(j);
    }
    tables.push({ hdr: i, sep: i + 1, dataIdx });
    i = j - 1;
  }

  // Second pass: decide + splice.
  for (const t of tables) {
    const hdrCells = cellsOf(lines[t.hdr]).map((c) => c.trim());
    const statusIdx = hdrCells.findIndex((c) => /^status$/i.test(c));
    const alreadyDone = hdrCells.some((c) => /^audit tiers$/i.test(c));
    const idRows = t.dataIdx.filter((k) => spec.idRe.test(lines[k]));
    if (alreadyDone) { tableLog.push(`  • SKIP (already has Audit Tiers): hdr@${t.hdr + 1}`); continue; }
    if (statusIdx < 0) { tableLog.push(`  • SKIP (no Status col): "${hdrCells.join(" | ")}" hdr@${t.hdr + 1}`); continue; }
    if (idRows.length === 0) { tableLog.push(`  • SKIP (no ${spec.tracker} id-rows): "${hdrCells.join(" | ")}" hdr@${t.hdr + 1}`); continue; }

    const hasTierCol = hdrCells.some((c) => /^tier$/i.test(c));
    const kind = spec.tracker === "ops" ? "ops" : hasTierCol ? "flows-coverage" : "tier-main";
    const hdrCellCount = hdrCells.length;
    tableLog.push(`  • INSERT kind=${kind} Status@idx${statusIdx} rows=${idRows.length} cols=${hdrCellCount}: "${hdrCells.join(" | ")}" hdr@${t.hdr + 1}`);

    // header + separator
    const newHdr = insertAfterStatus(lines[t.hdr], statusIdx, "Audit Tiers", false);
    const newSep = insertAfterStatus(lines[t.sep], statusIdx, "---", true);
    if (newHdr == null || newSep == null) throw new Error(`pipe-splice failed on header/sep @${t.hdr + 1}`);
    lines[t.hdr] = newHdr; lines[t.sep] = newSep; changed += 2;

    // data rows
    for (const k of t.dataIdx) {
      const cells = cellsOf(lines[k]); // escaped-pipe-aware split
      const id = (lines[k].match(/^\s*\|\s*(F?O?\#?\d+)\s*\|/) || [, "?"])[1];
      const flags = [];
      let token = "—";
      const dbg = { kind };

      // ---- derive the proposed token (pure fn of cells; mechanical safety handled below) ----
      if (kind === "ops") {
        const audited = cells[statusIdx + 1] ?? ""; // the Audited? column
        const { prov, kind: pk, coDate } = deriveProv(audited);
        const cVal = latest(classifyNarrative(String(audited)).perTier.c.map((x) => x.date));
        token = buildToken({ prov, c: cVal }, ["prov", "c"]);
        dbg.prov = prov; dbg.provKind = pk;
        if (!prov) flags.push(isComplete(cells[statusIdx]) ? "OPS-COMPLETE-no-prov" : "ops-no-prov");
        if (pk === "inherited") flags.push("ops-inherited-prov");
        if (coDate) flags.push("ops-date+via-ambiguous");
      } else {
        // tier-main: v1 = col after Status; narrative = Final col (skip Fixes at S+2).
        // flows-coverage: v1 = col after Status; narrative = Launch?+Notes (no Fixes col).
        const v1col = statusIdx + 1;
        const narrStart = kind === "tier-main" ? statusIdx + 3 : statusIdx + 2;
        const v1 = latestDateIn(cells[v1col] ?? "");
        const narrative = cells.slice(narrStart).join("|");
        const { perTier, ambiguous, allDates } = classifyNarrative(narrative);
        const v2 = latest(perTier.v2.map((x) => x.date));
        const v3 = latest(perTier.v3.map((x) => x.date));
        const v4 = latest(perTier.v4.map((x) => x.date));
        const c = latest(perTier.c.map((x) => x.date));
        token = buildToken({ v1, v2, v3, v4, c }, ["v1", "v2", "v3", "v4", "c"]);
        dbg.v1 = v1; dbg.v2 = v2; dbg.v3 = v3; dbg.v4 = v4; dbg.c = c;
        dbg.narrDates = allDates.length; dbg.classified = perTier.v2.length + perTier.v3.length + perTier.v4.length + perTier.c.length;
        if (ambiguous.length) flags.push("ambiguous:" + ambiguous.map((a) => a.date + "→" + a.chosen).join(","));
        if (!v1 && isComplete(cells[statusIdx])) flags.push("COMPLETE-no-v1");
        if (token === "—" && isComplete(cells[statusIdx])) flags.push("COMPLETE-but-no-token");
        if (isComplete(cells[statusIdx]) && !v2 && !v3 && !v4 && !c && v1) flags.push("v1-only(no-final-audit-derived)");
        if (kind === "flows-coverage" && !/^\s*(done|implicit|✅|complete)/i.test((cells[v1col] || "").trim().toLowerCase()) && v1) {
          flags.push("coverage-v1-low-confidence");
        }
      }

      // ---- SPLICE GUARD ----
      // (a) FEWER cells than the header = a pre-existing malformed row missing a
      //     column (e.g. a flows row that lost its Launch-block? col → 6 cells vs the
      //     7-col coverage header). The renderer already SKIPS it (cs.length below
      //     its threshold); splicing a column would push it ACROSS the threshold →
      //     the renderer would start counting it → row-count change (gate fail).
      //     So preserve byte-for-byte + flag for a separate repair.
      // (b) MORE cells than the header is FINE: the surplus is raw `|` chars inside
      //     the trailing narrative column (Final/Notes), which sits AFTER the
      //     insertion point — cellsOf splits left-to-right so the leading cells
      //     (#/name/[Tier]/Status) are always the first segments and the splice
      //     after Status lands correctly. The renderer already counts these rows
      //     (cs.length is well above threshold), so +1 keeps them counted.
      // (cellsOf is escaped-pipe-aware, so rows carrying `\|` read as exactly the
      //  header count and are NOT mistaken for malformed.)
      if (cells.length < hdrCellCount) {
        flags.push(`MALFORMED-ROW(${cells.length} cells < ${hdrCellCount}-col header — missing a column) — token NOT inserted (preserves renderer row-count). Repair the missing column separately, then re-run.`);
        review.push({ id, token, flags, dbg, line: k + 1, inserted: false });
        continue;
      }
      if (cells.length > hdrCellCount) dbg.trailingProsePipes = cells.length - hdrCellCount;
      const spliced = insertAfterStatus(lines[k], statusIdx, token, false);
      if (spliced == null) {
        flags.push("SPLICE-FAILED(too-few-pipes)-leaving-row-untouched");
        review.push({ id, token, flags, dbg, line: k + 1, inserted: false });
        continue;
      }
      lines[k] = spliced; changed++;
      review.push({ id, token, flags, dbg, line: k + 1, inserted: true });
    }
  }

  const out = lines.join("\n");
  if (!DRY && out !== raw) writeFileSync(abs, out, "utf8");
  // `file_` fills the slot the report header has always had and never populated (it printed a
  // bare `()`). It becomes load-bearing once a tracker is sharded: without it the run emits N
  // identically-labelled FLOWS blocks and a reader cannot tell which shard a finding came from.
  return { tracker: spec.tracker, file_: spec.file, review, tableLog, changed, wrote: !DRY && out !== raw };
}

// =================== run + report ===================
// ⛔ EXPAND EACH TRACKER TO ITS PHYSICAL FILES *BEFORE* PROCESSING, RATHER THAN TEACHING
// processFile() ABOUT SHARDS. This tool is a read-MODIFY-write: it rewrites the rows it edits.
// A shard is a complete markdown fragment — whole `### ` sections, each with its own table header
// and separator — so processFile()'s table discovery works on one unchanged, and each file is
// written back independently. Concatenating instead would force a re-split on every write.
// With no shards on disk this expands to exactly the original FILES, so today it is a no-op.
const EXPANDED = FILES.flatMap((spec) =>
  trackerFiles(join(ROOT, spec.file)).map((abs) => ({
    ...spec,
    file: abs.startsWith(ROOT) ? abs.slice(ROOT.length).replace(/^\/+/, "") : abs,
  }))
);
const results = EXPANDED.map(processFile);

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

for (const r of results) {
  console.log(`\n================ ${r.tracker.toUpperCase()}  (${r.file_||""}) ================`);
  console.log(`tables:`);
  for (const t of r.tableLog) console.log(t);
  console.log(`\nseeded tokens (${r.review.length} rows)${DRY ? " [DRY-RUN — no write]" : r.wrote ? " [WRITTEN]" : " [no change]"}:`);
  console.log("  id        | token");
  console.log("  ----------|------------------------------------------------------------");
  for (const row of r.review) {
    const flagStr = row.flags.length ? "   ⚠ " + row.flags.join(" · ") : "";
    const tok = row.inserted === false ? `${row.token}  [NOT WRITTEN]` : row.token;
    console.log(`  ${(row.id + "").padEnd(9)} | ${tok}${flagStr}`);
  }
  const flagged = r.review.filter((x) => x.flags.length);
  const notWritten = r.review.filter((x) => x.inserted === false).length;
  console.log(`\n  ${r.tracker}: ${r.review.length} rows seeded (${r.review.length - notWritten} written, ${notWritten} preserved-untouched) · ${flagged.length} FLAGGED for spot-check · ${r.changed} line-splices`);
}

console.log(`\n${DRY ? "DRY-RUN complete (no files written)." : "Backfill written to working tree (uncommitted)."}`);
