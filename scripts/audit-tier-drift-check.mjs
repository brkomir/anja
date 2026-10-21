#!/usr/bin/env node
/**
 * audit-tier-drift-check.mjs — read-only DRIFT DETECTOR for the `Audit Tiers`
 * tokens in the flows / features / ops trackers.
 *
 * THE DRIFT CLASS IT CATCHES (reconciled by hand 2026-06-23 — 25 flow rows):
 * an audit demonstrably ran (the Final-Audit NARRATIVE records a `--code` wave or
 * a `--final-audit` panel) but the row's compact `Audit Tiers` TOKEN never got the
 * matching `c:` / `v2:` key stamped — so `/flows|/features list` reads the flow as
 * less-audited than it is, and sessions mis-pick the audit type. The stamp-on-audit
 * rule (flows/SKILL.md §d) is process-only / unenforced; this is the structural net.
 *
 * It is a HEURISTIC SCOPER, not an auto-fixer: it flags (row, missing-key, date-hint)
 * pairs to VERIFY against git + narrative, never edits. Warn-mode: prints a
 * report; `--strict` exits 1 on any finding (for /orient or pre-push wiring after a
 * warn-mode observation window).
 *
 * Reuses `tracker-list.mjs`'s `parseAuditTiersToken` + `TRACKERS` (token grammar) AND
 * its `tableHeaderCells` + `findCol` (column LOCATION) — so it parses the token AND
 * locates the `Audit Tiers` column IDENTICALLY to the renderer (one shared definition;
 * a header-name / detection change is now a 1-site edit, and the renderer's header scan
 * rejects separator/non-header rows + resets the col-map on a no-tiers header). A full
 * `tracker-shared.mjs` kernel extraction (to also flip the detector→renderer dependency
 * direction) waits for a 3rd consumer (Rule-of-Three; design-doc §5 Status↔lifecycle check).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";
import { dirname, join } from "node:path";
import { TRACKERS, parseAuditTiersToken, tableHeaderCells, findCol } from "./tracker-list.mjs";
// ⛔ SHARD-AWARE READ. `cfg.file` alone is the ROUTER after a two-tier split, and a router carries
// no data rows — so this scanner read 0 rows for `flows` and printed "probable format drift" into
// every SessionStart banner while flows drift detection was simply DEAD (2026-09-09, after
// the split). `tracker-list.mjs` was made shard-aware in the same wave and this reader was missed
// because it reaches the tracker through the TRACKERS import, which no literal-path grep finds.
import { trackerFiles } from "./lib/tracker-shards.mjs";
const readTracker = (cfg) =>
  trackerFiles(join(ROOT, cfg.file)).flatMap((f) => readFileSync(f, "utf8").split("\n"));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Narrative markers → the token key the audit they describe should carry.
// Deliberately SPECIFIC to avoid the non-tier "v3" false positives (a "prompt
// v3.5" / "F8-v3 bug-class" reference must NOT trip the v2/v3 logic).
const MARK = {
  // a --code / builder≠breaker fix-wave review ran → expect a `c:` key. The POSITIVE
  // requires --code NEAR a wave/review word; the deferral/absence cases live in NEG.c.
  c: /builder\s*(?:≠|!=|-not-)\s*breaker|Step-2b[^.|]{0,60}(?:--code|reviewer)|--code\b[^.|]{0,30}(?:review|wave|fix|approv|gate|reviewer|builder)|(?:review|wave|fix-wave|gate|reviewer)[^.|]{0,22}--code\b/i,
  // a full --final-audit panel ran → expect a `v2:` key (flows/features grammar).
  // (`first final[- ]audit` dropped — dead alt, subsumed by `\bfinal[- ]audit\b`.)
  v2: /\bfinal[- ]audit\b|COMPLETE under v2\b/i,
  // a --v3-drift / drift re-audit ran → expect a `v3:` key. SPECIFIC ("v3-drift",
  // never bare /v3/) so "prompt v3.5" / "F8-v3 bug-class" don't FP. v3 (unlike v1,
  // which tierCells back-fills from the Initial col) does NOT self-heal in the renderer.
  v3: /\bv3[- ]drift\b|--v3-drift|\bv3 redo\b|\bv3 final[- ]audit\b/i,
  // a fourth-pass audit ran → expect a `v4:` key. The tier's own vocabulary, read off
  // the 11 rows that carried a `v4:` stamp on 2026-09-22: `COMPLETE under v4`, `v4
  // final audit` / `v4 re-audit` / `v4 audit ran`, and the record-header shape the
  // trackers use for every tier, `**v4** (2026-`. SPECIFIC like v3 — never bare /v4/,
  // so a `prompt v4` / `schema v4` / a `-v4-process.md` path cited from ANOTHER row
  // cannot trip it. (a review finding: the renderer learned v4 and this
  // detector — the one tool whose job is a v4 pass that reads as never having run —
  // could not represent the key at all.)
  v4: /\bCOMPLETE under v4\b|\bv4 (?:final[- ]audit|re-audit|audit ran|joint panel)\b|\*\*v4\*\*\s*\(20\d\d-\d\d-\d\d/i,
};

// Per-key NEGATION guards, keyed IDENTICALLY to MARK so "every marker has a paired
// guard" is STRUCTURAL — the bug a review of this file caught was a marker
// (`v2`) shipped WITHOUT its sibling guard. A guard suppresses BOTH "no audit ran"
// (absence) AND "audit pending/skipped/deferred" phrasings. Applied LOCALLY (a ±window
// around each MARK hit, see `markedUnguarded`) NOT whole-line: a tracker row is one
// multi-KB cell, so a whole-line guard would over-suppress a real wave that merely
// shares its row with an unrelated "under threshold" / "Check 13 N/A" clause far away.
const NEG = {
  c: /Check 1?3 N\/A|(?:under|below)[^.|]{0,18}(?:threshold|bar)|no --code|(?:--code|builder.{0,3}breaker)[^.|]{0,20}(?:defer|skip|pending|postpone|N\/A|not run|TODO)|(?:defer|skip|pending|postpone|await(?:ing)?|no|not[- ]yet)[^.|]{0,20}(?:--code|builder.{0,3}breaker)/i,
  v2: /final[- ]audit[^.|]{0,20}(?:pending|deferred|scheduled|planned|tbd|to run|yet|TODO|needed|candidate)|(?:before|await(?:ing)?|no|not[- ]yet|pre)[^.|]{0,8}final[- ]audit/i,
  // …PLUS a cross-flow `F<n>-v3 drift` reference (e.g. "posture held across F9-v3 drift"
  // narrated in ANOTHER flow's row) — that is the OTHER flow's v3 audit, never this row's.
  v3: /v3[- ](?:drift|redo)[^.|]{0,20}(?:pending|deferred|scheduled|planned|tbd|to run|yet|TODO|needed|candidate)|(?:before|await(?:ing)?|no|not[- ]yet|pre|skip)[^.|]{0,8}v3[- ](?:drift|redo)|F\d+[- ]v3[- ](?:drift|redo)/i,
  // …PLUS the cross-row shape a v4 narration takes: `F6 v4 final audit` / `Flow #1 v4
  // re-audit` cited from another row's cell (a spinoff brief, a shared-panel note).
  v4: /v4 (?:final[- ]audit|re-audit)[^.|]{0,20}(?:pending|deferred|scheduled|planned|tbd|to run|yet|TODO|needed|candidate|spinoff|brief)|(?:before|await(?:ing)?|no|not[- ]yet|pre|skip)[^.|]{0,8}v4 (?:final[- ]audit|re-audit)|(?:F\d+|Flows? #?\d+)[- ]v4 (?:final[- ]audit|re-audit)/i,
};

// v1 self-heals in the renderer (tierCells back-fills it from the Initial col); v3
// and v4 do NOT, so they ARE drift-checked. The order is the scan order per row.
const TIER_KEYS = ["v2", "v3", "v4", "c"];

// True iff `line` carries a MARK[key] hit whose LOCAL vicinity is NOT negated by
// NEG[key] — a real audit marker with no nearby deferral/absence qualifier. Walks
// EVERY hit (a row may narrate several waves); one un-negated hit ⇒ a finding.
function markedUnguarded(key, line, token = {}) {
  const re = new RegExp(MARK[key].source, "gi"); // global clone to scan every hit
  const neg = NEG[key];
  // A `--final-audit` is the tool for BOTH the v1 INITIAL audit AND a v3-drift panel — so a
  // v2-marker ("final-audit") sitting next to an already-stamped v1/v3 DATE is narrating THAT
  // audit, not a missing v2 re-grounding. Scoped to v2 ONLY: a genuine missing v2 carries a
  // NEW date (never suppressed), and c/v3/v4 are distinct types (a same-day --code IS its
  // own tier → must still flag). Closes the v1-conducted-via-final-audit FP. v4 is
  // in the list for the same reason v3 is: a fourth pass is ALSO run as a `--final-audit`
  // panel, so its `final-audit` narration beside an already-stamped v4 date is that pass,
  // not a missing v2 — without it every stamped v4 row re-opens that FP.
  const explainedBy =
    key === "v2" ? [token.v1, token.v3, token.v4].filter((d) => d && /^\d{4}-\d\d-\d\d$/.test(d)) : [];
  for (let m; (m = re.exec(line)); ) {
    const win = line.slice(Math.max(0, m.index - 24), m.index + m[0].length + 44);
    if (neg && neg.test(win)) continue; // local deferral / absence / cross-flow qualifier
    if (explainedBy.length) {
      // clip the date-correlation window to the marker's OWN table cell — a date in an
      // ADJACENT cell (the token col, the Initial col) must not spuriously "explain" it.
      const cellLo = line.lastIndexOf("|", m.index) + 1;
      const cellHiRaw = line.indexOf("|", m.index + m[0].length);
      const cellHi = cellHiRaw === -1 ? line.length : cellHiRaw;
      const dateWin = line.slice(Math.max(cellLo, m.index - 55), Math.min(cellHi, m.index + m[0].length + 55));
      if (explainedBy.some((d) => dateWin.includes(d))) continue; // already-stamped audit
    }
    return true;
  }
  return false;
}

// best-effort: the ISO date nearest a marker hit = the audit's date (a HINT to verify).
// Fallback to the row's LATEST ISO date when the marker sits far from any date in a
// multi-KB narrative cell (e.g. a row whose `--code` mention is clauses away from its
// 2026-06-23 v3-drift date) — a row-level hint beats a blank `?`.
function nearestDate(text, re) {
  const m = re.exec(text);
  if (m) {
    const win = text.slice(Math.max(0, m.index - 32), m.index + 90);
    const d = win.match(/\b20\d\d-\d\d-\d\d\b/);
    if (d) return d[0];
  }
  const all = text.match(/\b20\d\d-\d\d-\d\d\b/g);
  return all ? all.slice().sort().at(-1) : null;
}

// `injectedLines` is the test seam (mirrors tracker-list.mjs's `render({ lines })`):
// pass controlled rows to exercise the marker/guard logic without touching disk.
// `stats` (optional out-param, keeps the findings-array return shape the tests pin):
// receives { rows } = data rows actually scanned, so callers can detect a vacuous
// 0-row scan (idRe/format drift) instead of reading it as clean (BLIND≠CLEAN).
function scanTier(tracker, cfg, injectedLines, stats) {
  const lines = injectedLines || readTracker(cfg);
  const findings = [];
  let tiersIdx = -1;
  let rows = 0;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) { tiersIdx = -1; continue; } // section boundary → reset col map
    if (!cfg.idRe.test(line)) { const hc = tableHeaderCells(line); if (hc) tiersIdx = findCol(hc, /audit tiers/); continue; }
    rows++;
    const cs = line.split("|").slice(1, -1);
    const num = parseInt((cs[0].match(/\d+/) || [0])[0], 10);
    const id = cfg.label(num);
    const tokenRaw = tiersIdx >= 0 && tiersIdx < cs.length ? cs[tiersIdx] : null;
    const token = parseAuditTiersToken(tokenRaw); // null=no token, {}=—(never), {keys}
    if (token === null) {
      // blank/absent token cell BUT the narrative shows a real audit ran → un-backfilled.
      // Same per-key guards as the parsed branch (the asymmetry the review caught was a
      // guard applied to one branch/marker but not its siblings).
      if (TIER_KEYS.some((k) => markedUnguarded(k, line)))
        findings.push({ id, kind: "UN-BACKFILLED", detail: "narrative shows audit markers but token cell is blank/absent" });
      continue;
    }
    const neverAudited = Object.keys(token).length === 0; // literal —
    for (const key of TIER_KEYS) {
      if (token[key] || !markedUnguarded(key, line, token)) continue;
      findings.push({
        id, kind: neverAudited ? `TOKEN=— but ${key}-marker` : `MISSING ${key}`,
        hint: nearestDate(line, MARK[key]) || "?",
      });
    }
  }
  if (stats) stats.rows = rows;
  return findings;
}

// ops uses the prov:/c: grammar (no v1/v2/v3) — report token coverage, don't v2-check
function scanOps(cfg) {
  const lines = readTracker(cfg);
  let tiersIdx = -1, audited = 0, tokened = 0, total = 0;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) { tiersIdx = -1; continue; }
    if (!cfg.idRe.test(line)) { const hc = tableHeaderCells(line); if (hc) tiersIdx = findCol(hc, /audit tiers/); continue; }
    total++;
    const cs = line.split("|").slice(1, -1);
    const token = parseAuditTiersToken(tiersIdx >= 0 && tiersIdx < cs.length ? cs[tiersIdx] : null);
    if (token && Object.keys(token).length) tokened++;
    if (/\bCOMPLETE\b/i.test(cs[2] || "")) audited++;
  }
  return { total, audited, tokened };
}

function main(argv) {
  const strict = argv.includes("--strict");
  let total = 0;
  for (const tracker of ["flows", "features"]) {
    const stats = {};
    const findings = scanTier(tracker, TRACKERS[tracker], undefined, stats);
    total += findings.length;
    console.log(`\n=== ${tracker} — ${findings.length} drift finding(s), ${stats.rows} row(s) scanned ===`);
    for (const f of findings)
      console.log(`  ${f.id}: ${f.kind}${f.hint ? ` (date-hint ${f.hint})` : ""}${f.detail ? ` — ${f.detail}` : ""}`);
    if (!findings.length) {
      // BLIND≠CLEAN: the tracker file exists (readFileSync succeeded) but the idRe/format
      // matched no rows — a vacuous scan set must not read as a clean pass.
      if (stats.rows === 0) console.log("  ⚠️ 0 rows scanned — probable format drift (vacuous pass, not clean)");
      else console.log(`  ✓ clean — every audit marker has its token key (${stats.rows} rows scanned)`);
    }
  }
  const o = scanOps(TRACKERS.ops);
  console.log(`\n=== ops — token coverage ===`);
  console.log(`  ${o.tokened}/${o.total} rows carry an Audit Tiers token (${o.audited} COMPLETE). prov:/c: grammar — v2/c drift-check N/A.`);
  if (o.tokened === 0) console.log("  ⓘ Audit Tiers column un-backfilled → a BACKFILL task, not a drift-fix.");
  console.log(`\nTOTAL flows+features drift findings: ${total}`);
  if (strict && total) process.exit(1);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
export { scanTier, MARK, NEG, markedUnguarded };
