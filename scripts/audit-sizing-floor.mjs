#!/usr/bin/env node
// audit-sizing-floor.mjs — the SSOT that COMPUTES the mandatory verification-instrument floor
// for closing a flow/feature, so the sizing stops being a judgment that gets silently undersized.
//
// WHY: `minimum-viable-scope:instrument-undersize` is the highest-stakes MVS
// sub-mode — its miss is INVISIBLE at miss time and the undersized gate WAS the last net (an
// undersized panel can let a serious defect through past fully passing /audit-check runs). It is
// WORK-remediable, not rewrite-remediable: the prose row was loaded and the undersizing kept
// happening (reasoned-values errors, not missing facts). So the remedy RAISES the floor to an explicit,
// logged deviation — it does NOT remove the choice (undersizing is a reasoned error PAST a known rule; a
// computed floor re-frames going lighter as a logged, deliberate deviation). This script computes the
// floor from observable keys; going BELOW it is an explicit owner pick with a logged reason, never a
// silent default. Codifies (does not invent): flows/SKILL.md:59, the /expert-review sizing table
// (Full 7-15 / Lean 3-5), the --code mandatory floor.
//
// Consumers: /expert-review + /flows closer-selection steps (compute the floor before picking an
// instrument); audit-floor-check.mjs (the self-detecting-absence net).
// Self-test (instrument standard, RED-control per branch): node scripts/audit-sizing-floor.mjs --self-test

import { pathToFileURL } from "node:url";

import { isMain as isMainModule } from "./lib/is-main.mjs";
// EXPORTED so consumers can REJECT an unrecognized token rather than inherit the silent drop below:
// `stakes.filter((s) => HIGH_STAKES.has(s))` is exact-match, so `Premium`, `premiun` and `""` all
// vanish and the row reads LOW-STAKES. That is fail-OPEN, and `audit-floor-check.mjs` turns it into
// an escape hatch (a mis-declared row could retire someone else's flag). Duplicating this set in a
// consumer would be a drift surface; exporting it is the reason it is not `const`-private.
export const HIGH_STAKES = new Set(["revenue", "legal", "premium", "safety"]);
const DIFF_REVIEWABLE = new Set(["logic", "security", "cross-surface", "shared-state"]);
const STALE_DAYS = 30; // an initial audit ≥30 days old is stale → fresh panel

// The ONE computation — both main() and selfTest() call this, so the self-test exercises the real
// logic, not a mirror of it.
export function computeFloor({
  stakes = [],            // array of {revenue,legal,premium,safety}
  lastAuditDays = null,   // number, or null = "never audited"
  hadFinalAudit = false,  // has a --final-audit panel EVER run for this surface?
  ownerInvoked = null,    // the mode the owner explicitly invoked (locks the floor at/above it)
  diffClass = "none",     // {logic,security,cross-surface,shared-state,trivial,none} for the --code floor
} = {}) {
  const reasons = [];
  const highStakes = stakes.filter((s) => HIGH_STAKES.has(s));
  const stale = lastAuditDays === null || lastAuditDays >= STALE_DAYS;

  // ---- closer floor: audit-check-sole-OK vs final-audit-required ----
  let closerFloor = "audit-check-sole-ok";
  if (highStakes.length) {
    closerFloor = "final-audit-required";
    reasons.push(`high-stakes (${highStakes.join("+")}) → a fresh --final-audit panel FINDS new findings; /audit-check only VERIFIES`);
  }
  if (!hadFinalAudit) {
    closerFloor = "final-audit-required";
    reasons.push("no --final-audit panel has EVER run for this surface → /audit-check alone can't close it");
  } else if (stale) {
    closerFloor = "final-audit-required";
    reasons.push(`last audit ${lastAuditDays === null ? "never" : lastAuditDays + "d"} ago ≥ ${STALE_DAYS}d stale → re-run --final-audit before /audit-check`);
  }
  if (closerFloor === "audit-check-sole-ok") {
    reasons.push("low-stakes AND a prior thorough audit is recent (<30d) → /audit-check sole-closer is allowed");
  }

  // ---- owner-invoked lock: never run lighter than invoked ----
  let invokedLock = null;
  if (ownerInvoked && ownerInvoked !== "none") {
    invokedLock = ownerInvoked;
    reasons.push(`owner invoked \`${ownerInvoked}\` — run it AS-INVOKED; substituting a lighter mode is :directive-shrink`);
    // an owner-invoked final-audit forces the closer floor up too
    if (ownerInvoked === "final-audit") closerFloor = "final-audit-required";
  }

  // ---- min panel (the /expert-review sizing table: Full/--final-audit = 7-15) ----
  // ownerInvoked==="final-audit" already forced closerFloor above (:56-60), so no separate invokedLock
  // disjunct is needed here (the disjunct was redundant / green-under-mutation).
  const needsFullPanel = closerFloor === "final-audit-required";
  const minPanel = needsFullPanel ? 7 : 0; // 0 = a panel is not the mandated closer (verify-only or lean-permitted)
  if (needsFullPanel) reasons.push("a --final-audit / Full panel is 7-15 experts → floor ≥ 7 (/expert-review sizing table)");

  // ---- --code mandatory floor (a proxy for RISK, not LOC) ----
  const codeRequired = DIFF_REVIEWABLE.has(diffClass);
  if (codeRequired) reasons.push(`the diff touches ${diffClass} → a builder≠breaker --code review is MANDATORY, never "optional"`);

  const verdictBits = [];
  verdictBits.push(closerFloor === "final-audit-required" ? "--final-audit REQUIRED (not /audit-check alone)" : "/audit-check sole-closer OK");
  if (minPanel) verdictBits.push(`≥${minPanel} experts`);
  if (codeRequired) verdictBits.push("mandatory --code");
  if (invokedLock) verdictBits.push(`owner-invoked \`${invokedLock}\` MUST NOT be substituted`);
  const verdict = `FLOOR: ${verdictBits.join(" · ")}. Going BELOW this floor is an explicit owner pick with a logged reason — never a default.`;

  return { closerFloor, minPanel, codeRequired, invokedLock, reasons, verdict };
}

function selfTest() {
  // ≥1 RED-control per detection branch (mutation-valid — flip a rule and a case goes RED).
  const cases = [
    ["low-stakes recent audited → audit-check OK",
      { stakes: [], lastAuditDays: 5, hadFinalAudit: true, diffClass: "none" },
      (r) => r.closerFloor === "audit-check-sole-ok" && r.minPanel === 0 && !r.codeRequired],
    ["high-stakes (revenue) → final-audit required + ≥7",
      { stakes: ["revenue"], lastAuditDays: 5, hadFinalAudit: true },
      (r) => r.closerFloor === "final-audit-required" && r.minPanel === 7],
    ["premium touch → final-audit required",
      { stakes: ["premium"], lastAuditDays: 2, hadFinalAudit: true },
      (r) => r.closerFloor === "final-audit-required"],
    ["never had a --final-audit → final-audit required even if low-stakes+recent",
      { stakes: [], lastAuditDays: 1, hadFinalAudit: false },
      (r) => r.closerFloor === "final-audit-required"],
    ["stale (≥30d) → final-audit required",
      { stakes: [], lastAuditDays: 45, hadFinalAudit: true },
      (r) => r.closerFloor === "final-audit-required"],
    ["exactly 30d = stale boundary (>= is stale)",
      { stakes: [], lastAuditDays: 30, hadFinalAudit: true },
      (r) => r.closerFloor === "final-audit-required"],
    ["exactly 29d = NOT stale",
      { stakes: [], lastAuditDays: 29, hadFinalAudit: true },
      (r) => r.closerFloor === "audit-check-sole-ok"],
    ["owner-invoked final-audit locks the floor + forbids substitution",
      { stakes: [], lastAuditDays: 2, hadFinalAudit: true, ownerInvoked: "final-audit" },
      (r) => r.invokedLock === "final-audit" && r.closerFloor === "final-audit-required"],
    ["diff touches security → --code mandatory (independent of closer)",
      { stakes: [], lastAuditDays: 2, hadFinalAudit: true, diffClass: "security" },
      (r) => r.codeRequired === true],
    ["trivial diff → --code NOT forced",
      { stakes: [], lastAuditDays: 2, hadFinalAudit: true, diffClass: "trivial" },
      (r) => r.codeRequired === false],
  ];
  let fail = 0;
  console.log("=== audit-sizing-floor --self-test (instrument standard) ===");
  for (const [label, input, ok] of cases) {
    const r = computeFloor(input);
    const pass = ok(r);
    if (!pass) fail++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}`);
    if (!pass) console.log(`         got: ${JSON.stringify({ closerFloor: r.closerFloor, minPanel: r.minPanel, codeRequired: r.codeRequired, invokedLock: r.invokedLock })}`);
  }
  // parseArgs STRICTNESS — mutation-valid: revert the null-coerce or the throw and a case flips RED.
  const pcases = [
    ["parseArgs: unparseable --last-audit-days → null (=never=stale=final-audit, never silently not-stale)",
      () => parseArgs(["--last-audit-days", "abc"]).lastAuditDays === null],
    ["parseArgs: valid --last-audit-days still parses to the number",
      () => parseArgs(["--last-audit-days", "5"]).lastAuditDays === 5],
    ["parseArgs: unknown flag THROWS (strict, not silently-lenient)",
      () => { try { parseArgs(["--stake", "premium"]); return false; } catch { return true; } }],
  ];
  for (const [label, ok] of pcases) {
    let pass; try { pass = ok(); } catch { pass = false; }
    if (!pass) fail++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}`);
  }
  const total = cases.length + pcases.length;
  console.log(fail ? `FAILED: ${fail} failure(s)` : `OK: ${total} pass / 0 fail`);
  return fail ? 1 : 0;
}

export function parseArgs(argv) {
  const a = { stakes: [], lastAuditDays: null, hadFinalAudit: false, ownerInvoked: null, diffClass: "none" };
  const KNOWN = new Set(["--stakes", "--last-audit-days", "--had-final-audit", "--owner-invoked", "--diff-class"]);
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = argv[i].includes("=") ? argv[i].split("=") : [argv[i], argv[i + 1]];
    if (!argv[i].includes("=") && v !== undefined && !v.startsWith("--")) i++;
    // STRICT, never silently-lenient: an unknown flag or an unparseable value that
    // silently fell to the lenient audit-check-sole-ok floor is the EXACT silent-undersize this
    // instrument exists to prevent, one meta-level up — an LLM caller is a realistic typo source.
    if (!KNOWN.has(k)) throw new Error(`unknown flag "${k}" — refusing to compute a floor on unparsed input`);
    if (k === "--stakes") {
      a.stakes = (v || "").split(",").map((s) => s.trim()).filter((s) => s && s !== "none");
      for (const s of a.stakes) {
        if (!HIGH_STAKES.has(s)) console.error(`audit-sizing-floor: WARN "${s}" is not a high-stakes token (${[...HIGH_STAKES].join("/")}) — it does NOT raise the floor; check for a typo`);
      }
    } else if (k === "--last-audit-days") {
      if (v === "never") a.lastAuditDays = null;
      else { const n = Number(v); a.lastAuditDays = Number.isFinite(n) ? n : null; } // unparseable → null = never = STALE = final-audit-required (the SAFE side, never silently not-stale)
    } else if (k === "--had-final-audit") a.hadFinalAudit = v === "true";
    else if (k === "--owner-invoked") a.ownerInvoked = v === "none" ? null : v;
    else if (k === "--diff-class") a.diffClass = v || "none";
  }
  return a;
}

// CLI only when invoked directly — NEVER on import (else `import { computeFloor }` runs this).
if (isMainModule(import.meta.url)) {
  if (process.argv[2] === "--self-test") {
    process.exit(selfTest());
  }
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`audit-sizing-floor: ${e.message}`); process.exit(2); }
  const floor = computeFloor(parsed);
  console.log(floor.verdict);
  console.log("Reasons:");
  for (const r of floor.reasons) console.log(`  - ${r}`);
  console.log(`\nJSON: ${JSON.stringify({ closerFloor: floor.closerFloor, minPanel: floor.minPanel, codeRequired: floor.codeRequired, invokedLock: floor.invokedLock })}`);
}
