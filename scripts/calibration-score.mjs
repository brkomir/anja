#!/usr/bin/env node
/**
 * calibration-score.mjs — dual over-/under-caution calibration score (REPORT-ONLY).
 *
 * Adopted 2026-07-18 from a review of external systems on "agent stimulation"
 * (guildhall lens — src/runtime/model-bakeoff.ts laneScore weights). The
 * finding: our `/meta corrections --analyze` measures only ONE pole (over-hedge /
 * under-scope frequency), which is gameable — an agent told "hedge less" can
 * improve the visible pole by shifting failures to the invisible one (confident-
 * wrong). This script scores BOTH poles from telemetry we already log, with
 * guildhall's weights: under-caution (confident-wrong) is priced 1.5x worse.
 *
 *   over-caution  event x (-20)   // hedged / under-scoped when acting was right
 *   under-caution event x (-30)   // asserted / claimed-done when it wasn't
 *
 * HARD CONSTRAINT (guildhall's simulation caveat, load-bearing): this score is a
 * MEASUREMENT feeding the owner's read — it must NOT be wired into any agent-
 * facing incentive/prompt loop until baseline data shows it moves anything.
 * Score and incentive stay decoupled.
 *
 * Inputs (all existing telemetry — no new plumbing):
 *   .claude/meta-corrections-registry.md   entry headers `## YYYY-MM-DD <sid> ...`
 *                                          + `**Pattern tag:** \`tag\`` (primary = first tag)
 *   .claude/logs/audit-findings.jsonl      rows: {audit_id, status, ...} — no date field
 *   .claude/logs/audit-runs.jsonl          rows: {audit_id, date, ...}  — date join source
 *
 * v1 POLE PROXIES (tunable — edit the maps below, they are the whole model):
 *   over-caution  <- registry primary-tag FAMILY in OVER_CAUTION_FAMILIES
 *   under-caution <- registry primary-tag FAMILY in UNDER_CAUTION_FAMILIES
 *                  + audit-findings rows with status "refuted" (a confidently
 *                    asserted finding that verification killed)
 *   everything else -> "unscored" (reported, never silently dropped)
 *
 * Usage:
 *   node scripts/calibration-score.mjs [--since YYYY-MM-DD] [--json]
 *   node scripts/calibration-score.mjs --self-test
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { isMain as isMainModule } from "./lib/is-main.mjs";
const WEIGHT_OVER = -20; // falseEscalation analogue (guildhall)
const WEIGHT_UNDER = -30; // falseApproval analogue (guildhall)

// Family = tag prefix before the first ":" (matches the registry's sub-tag convention).
const OVER_CAUTION_FAMILIES = new Set([
  "minimum-viable-scope", // under-scoping / defer-bias (incl. all :sub-tags)
  "over-narrowing",
  "option-splitting", // decision-avoidance = a hedge in option form
  "cost-rationalization", // scope-shrink justified by cost
]);
const UNDER_CAUTION_FAMILIES = new Set([
  "under-justification", // asserted without verifying (incl. :stale-live-state, the folded-in ex-`unverified-state-assertion` family, 2026-07-24 — family() normalizes it here)
]);

function family(tag) {
  return tag.split(":")[0].trim();
}

export function parseRegistry(md) {
  const events = [];
  const lines = md.split("\n");
  let current = null;
  for (const line of lines) {
    const head = line.match(/^## (\d{4}-\d{2}-\d{2}) (\S+)/);
    if (head) {
      current = { date: head[1], sid: head[2], tag: null };
      events.push(current);
      continue;
    }
    if (current && !current.tag && line.startsWith("**Pattern tag:**")) {
      const tags = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (tags.length) current.tag = tags[0]; // primary only — secondaries would double-weight
    }
  }
  return events.filter((e) => e.tag);
}

export function parseFindings(findingsJsonl, runsJsonl) {
  const dates = new Map();
  for (const line of runsJsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.audit_id && r.date) dates.set(r.audit_id, r.date);
    } catch {
      /* skip malformed row */
    }
  }
  const refuted = [];
  for (const line of findingsJsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const f = JSON.parse(line);
      if (f.status === "refuted")
        refuted.push({ date: dates.get(f.audit_id) ?? null, id: f.finding_id });
    } catch {
      /* skip malformed row */
    }
  }
  return refuted;
}

export function score(events, refuted, since) {
  const inWindow = (d) => !since || (d !== null && d >= since);
  const over = new Map(); // family -> count
  const under = new Map(); // source -> count
  let unscored = 0;
  let outOfWindow = 0;

  for (const e of events) {
    if (!inWindow(e.date)) {
      outOfWindow++;
      continue;
    }
    const fam = family(e.tag);
    if (OVER_CAUTION_FAMILIES.has(fam)) over.set(fam, (over.get(fam) ?? 0) + 1);
    else if (UNDER_CAUTION_FAMILIES.has(fam)) under.set(fam, (under.get(fam) ?? 0) + 1);
    else unscored++;
  }
  let refutedCount = 0;
  for (const r of refuted) {
    if (!inWindow(r.date)) {
      outOfWindow++;
      continue;
    }
    refutedCount++;
  }
  if (refutedCount) under.set("refuted-findings", refutedCount);

  const overTotal = [...over.values()].reduce((a, b) => a + b, 0);
  const underTotal = [...under.values()].reduce((a, b) => a + b, 0);
  return {
    over: Object.fromEntries(over),
    under: Object.fromEntries(under),
    overTotal,
    underTotal,
    unscored,
    outOfWindow,
    weighted: overTotal * WEIGHT_OVER + underTotal * WEIGHT_UNDER,
  };
}

function render(result, since) {
  const lines = [];
  lines.push(`Calibration score — dual anti-metric (weights ${WEIGHT_OVER} over / ${WEIGHT_UNDER} under; guildhall). REPORT-ONLY.`);
  lines.push(`window: ${since ?? "all-time"}`);
  lines.push(
    `  over-caution  (hedge / under-scope, x${WEIGHT_OVER}): ${result.overTotal} events -> ${result.overTotal * WEIGHT_OVER}`
  );
  for (const [k, v] of Object.entries(result.over)) lines.push(`      ${k}: ${v}`);
  lines.push(
    `  under-caution (confident-wrong,  x${WEIGHT_UNDER}): ${result.underTotal} events -> ${result.underTotal * WEIGHT_UNDER}`
  );
  for (const [k, v] of Object.entries(result.under)) lines.push(`      ${k}: ${v}`);
  lines.push(`  weighted score: ${result.weighted}`);
  lines.push(
    `  unscored registry events (unmapped tag families — see maps in this script): ${result.unscored}`
  );
  if (since) lines.push(`  outside window (excluded): ${result.outOfWindow}`);
  lines.push(
    `  read: the RATIO matters more than the absolute — a falling over-caution count with a rising under-caution count is a net LOSS (the gaming this metric exists to catch).`
  );
  return lines.join("\n");
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "calib-"));
  try {
    const registry = [
      "# Meta-Corrections Registry",
      "",
      "## Pattern-tag taxonomy (seeded)",
      "| `minimum-viable-scope` | ... |",
      "",
      "## Entries",
      "",
      "## 2026-07-01 <session-id> — under-scoped a fix",
      "**Pattern tag:** `minimum-viable-scope:surfaced-defer`",
      "",
      "## 2026-07-05 <session-id> — narrowed a rec",
      "**Pattern tag:** `over-narrowing` (+`cost-rationalization` secondary)",
      "",
      "## 2026-07-10 <session-id> — asserted unverified claim",
      "**Pattern tag:** `under-justification`",
      "",
      "## 2026-07-12 <session-id> — preference miss",
      "**Pattern tag:** `preference-violation:verify-before-assert`",
    ].join("\n");
    const runs = [
      JSON.stringify({ audit_id: "a1", date: "2026-07-08" }),
      JSON.stringify({ audit_id: "a2", date: "2026-06-01" }),
    ].join("\n");
    const findings = [
      JSON.stringify({ audit_id: "a1", finding_id: "f1", status: "refuted" }),
      JSON.stringify({ audit_id: "a1", finding_id: "f2", status: "confirmed" }),
      JSON.stringify({ audit_id: "a2", finding_id: "f3", status: "refuted" }),
    ].join("\n");
    writeFileSync(join(dir, "reg.md"), registry);

    const events = parseRegistry(registry);
    const refuted = parseFindings(findings, runs);
    const assert = (cond, msg) => {
      if (!cond) {
        console.error(`SELF-TEST FAIL: ${msg}`);
        process.exit(1);
      }
    };

    assert(events.length === 4, `parsed ${events.length} events, expected 4`);
    assert(events[0].tag === "minimum-viable-scope:surfaced-defer", "primary-tag extraction");
    assert(events[1].tag === "over-narrowing", "primary tag must be FIRST backticked token only");
    assert(refuted.length === 2, `parsed ${refuted.length} refuted, expected 2`);
    assert(refuted[0].date === "2026-07-08", "audit_id->date join");

    // All-time: over = MVS + over-narrowing = 2; under = under-justification + 2 refuted = 3; unscored = 1
    const all = score(events, refuted, null);
    assert(all.overTotal === 2, `all-time overTotal ${all.overTotal}, expected 2`);
    assert(all.underTotal === 3, `all-time underTotal ${all.underTotal}, expected 3`);
    assert(all.unscored === 1, `all-time unscored ${all.unscored}, expected 1`);
    assert(all.weighted === 2 * WEIGHT_OVER + 3 * WEIGHT_UNDER, "weighted math");

    // Windowed since 2026-07-04: drops the 07-01 MVS event + the 06-01 refuted finding
    const win = score(events, refuted, "2026-07-04");
    assert(win.overTotal === 1, `windowed overTotal ${win.overTotal}, expected 1`);
    assert(win.underTotal === 2, `windowed underTotal ${win.underTotal}, expected 2`);
    assert(win.outOfWindow === 2, `windowed outOfWindow ${win.outOfWindow}, expected 2`);

    console.log("SELF-TEST PASS (parser, primary-tag rule, date-join, all-time + windowed scoring)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error("--since expects YYYY-MM-DD");
    process.exit(1);
  }

  const read = (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const events = parseRegistry(read(".claude/meta-corrections-registry.md"));
  const refuted = parseFindings(
    read(".claude/logs/audit-findings.jsonl"),
    read(".claude/logs/audit-runs.jsonl")
  );
  const result = score(events, refuted, since);
  if (args.includes("--json")) console.log(JSON.stringify({ since, ...result }, null, 2));
  else console.log(render(result, since));
}

// ⛔ THE CLI IS GUARDED SO THE MODULE STAYS IMPORTABLE. `main()` ends in `process.exit()`,
// which at module top level fires during `import` and makes every `export` above unreachable —
// and the failure surfaces INSIDE the importer, reading as a broken probe rather than a broken
// script. Same guard, same reason, as scripts/derive-sr-formal-verbs.mjs (2026-08-19).
const isMain = isMainModule(import.meta.url);
if (isMain) main();
