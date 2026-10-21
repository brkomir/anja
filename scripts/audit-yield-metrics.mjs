#!/usr/bin/env node
// audit-yield-metrics.mjs — the re-runnable kill-rule cadence-gate for the
// 7a-ii DEPTH / confirm-pass mechanism.
//
// Reads the two append-only audit ledgers and prints the 4 pre-registered
// deciders + the N=6/X=2 kill-rule
// verdict. Run this BEFORE each future panel to answer "should the 2nd
// (depth/confirm) pass run on panel #N+1?".
//
//   node scripts/audit-yield-metrics.mjs [runsPath] [findingsPath]
//
// Exit code is always 0 (advisory report, not a CI gate) — read the VERDICT
// line. Kept dependency-free (node:fs only) so it runs anywhere.
//
// Decider definitions (all computed from per-finding rows):
//   1. pass2_netnew_highsev = COUNT(pass_origin=2 AND severity∈{P0,P1} AND status confirmed*)
//        — the value-prop of the 2nd pass: high-sev findings pass-1 MISSED in the same audit.
//   2. refute_count        = COUNT(status='refuted')  +  overturn_rate = refuted/(refuted+reconfirmed)
//        — pass-1 leads the depth-probe OVERTURNED. A refuted lead is pass_origin=1 (DISCOVERED
//          in pass-1, KILLED by pass-2) — so count across ALL findings, not just pass2 (a pass2
//          filter always reads 0). The status wiring shipped 2026-06-18; reads 0
//          until a deep-probe logs its first refutation (forward-only — pre-wiring audits predate
//          it), then overturn_rate is the true confirm-vs-refute signal.
//   3. confirm_only_ratio  = 1 − pass2_netnew_highsev / pass2_total  (proxy)
//        — low-value share of pass-2 output (P2/P3 + deferred filler). Decider #2's overturn_rate
//          is now the DIRECT confirm-vs-refute measure (was a gap until the 2026-06-18 wiring).
//   4. escaped_P0P1_rate   = pass2_highsev_confirmed / all_highsev_confirmed
//        — fraction of all validated P0/P1 that pass-1 alone would have MISSED.
//
// Kill-rule: sample N high-stakes audits; KILL the depth pass if net-new validated
// P0/P1 < X over the window. N=6 / X=2. FAST-KILL at N≥3 if 0 net-new AND 0 refute.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const X = 2; // min net-new validated P0/P1 to KEEP
const N_WINDOW = 6; // min sample of depth-pass runs before the rule decides
const N_FAST = 3; // fast-kill window

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const runsPath = process.argv[2] || join(repoRoot, ".claude/logs/audit-runs.jsonl");
const findingsPath =
  process.argv[3] || join(repoRoot, ".claude/logs/audit-findings.jsonl");

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${path}: bad JSON on line ${i + 1}: ${e.message}`);
      }
    });
}

const runs = readJsonl(runsPath);
const findings = readJsonl(findingsPath);

const isHi = (f) => f.severity === "P0" || f.severity === "P1";
const isConfirmed = (f) => f.status === "confirmed" || f.status === "reconfirmed"; // a validated FINDING that stands. EXCLUDES confirmed-clean (= a dimension confirmed CLEAN / no-issue per SKILL.md 8b — NOT a finding; the old startsWith("confirmed") swept it into d1/allHiConf, counting clean bills of health as "net-new validated P0/P1") + refuted/deferred. Strict-eq is null-safe so the typeof guard is unneeded.
const pass2 = findings.filter((f) => f.pass_origin === 2);

// ---- DATA-INTEGRITY: evidence_class=CONVERGED must be INDEPENDENT of pass_origin=2 ----
// (a naive preview showed both ≈25 — verify they are not the
//  same column conflated before trusting "net-new from pass-2" literally.)
const conv = new Set(
  findings.filter((f) => f.evidence_class === "CONVERGED").map((f) => `${f.audit_id}|${f.finding_id}`),
);
const p2set = new Set(pass2.map((f) => `${f.audit_id}|${f.finding_id}`));
const inter = [...conv].filter((k) => p2set.has(k)).length;
const identical = conv.size === p2set.size && inter === conv.size;
const independent = !identical; // not the same tag

// ---- 4 DECIDERS ----
const d1_list = pass2.filter((f) => isHi(f) && isConfirmed(f));
const d1 = d1_list.length; // pass2_netnew_highsev
// refute_count: a refuted lead was DISCOVERED in pass-1 (pass_origin=1) and KILLED by the pass-2
// deep-probe — count status='refuted' across ALL findings, NOT just pass2 (a pass2 filter always
// reads 0 since refuted leads are pass_origin=1).
const d2 = findings.filter((f) => f.status === "refuted").length; // refute_count
const reconf = findings.filter((f) => f.status === "reconfirmed").length; // reconfirm_count
const adjudicated = d2 + reconf; // pass-1 leads a deep-probe actually re-examined
const overturnRate = adjudicated ? d2 / adjudicated : 0; // true confirm-vs-refute signal — decider #2's direct measure, supersedes #3's proxy
const d3 = pass2.length ? 1 - d1 / pass2.length : 0; // confirm_only_ratio (proxy)
const allHiConf = findings.filter((f) => isHi(f) && isConfirmed(f)).length;
const d4 = allHiConf ? d1 / allHiConf : 0; // escaped_P0P1_rate

// ---- KILL-RULE ----
// N = the depth-pass runs only (pass_count≥2) — the SAME population d1's numerator is drawn from
// (pass_origin=2 net-new can ONLY accrue where the depth pass fired). Counting all runs would
// dilute the kill window + misreport "≥6 MET" on a sample d1 couldn't have accrued over.
// (Same numerator/denominator-population class as the d2 fix.)
const N = runs.filter((r) => (r.pass_count ?? 0) >= 2).length;
const fastKill = N >= N_FAST && d1 === 0 && d2 === 0;
const kill = N >= N_WINDOW && d1 < X;
const mechVerdict = kill || fastKill ? "KILL" : "KEEP";

// ---- REPORT ----
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log("══════════════════════════════════════════════════════════════════");
console.log(" AUDIT-YIELD KILL-RULE  —  7a-ii DEPTH/confirm-pass mechanism");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  ledgers: ${runs.length} audit runs · ${findings.length} findings`);
console.log("");

console.log("DATA-INTEGRITY  (CONVERGED ⟂ pass_origin?)");
console.log(`  evidence_class=CONVERGED .......... ${conv.size}`);
console.log(`  pass_origin=2 ..................... ${p2set.size}`);
console.log(`  intersection (CONVERGED ∧ pass2) .. ${inter}`);
console.log(`  INDEPENDENT COLUMNS? .............. ${independent ? "YES ✓" : "NO ✗ (CONFLATED — deciders untrustworthy)"}`);
console.log("");

console.log("DECIDERS");
console.log(`  1. pass2_netnew_highsev (P0/P1 confirmed) . ${d1}   [KEEP if ≥ ${X}]`);
console.log(`  2. refute_count ........................... ${d2}   ${adjudicated ? `(${reconf} reconfirmed · overturn-rate ${pct(overturnRate)})` : "(0 — no deep-probe has logged a refutation yet; forward-only since the 2026-06-18 wiring)"}`);
console.log(`  3. confirm_only_ratio (low-value share) ... ${pct(d3)}  (${pass2.length - d1}/${pass2.length} of pass-2 is P2/P3/deferred filler)`);
console.log(`  4. escaped_P0P1_rate ...................... ${pct(d4)}  (${d1}/${allHiConf} validated P0/P1 escaped pass-1)`);
console.log("");
if (d1_list.length) {
  console.log("  net-new P0/P1 (the load-bearing finds):");
  for (const f of d1_list)
    console.log(`     · [${f.severity}] ${f.audit_id} — ${f.finding_id}`);
  console.log("");
}

// per-audit depth-pass table
console.log("PER-AUDIT (depth pass = pass_count≥2)");
console.log(`  ${"audit_id".padEnd(34)}${"pc".padEnd(4)}${"p2".padEnd(4)}p2_hi_conf`);
for (const r of runs) {
  const fs = findings.filter((f) => f.audit_id === r.audit_id);
  const p2 = fs.filter((f) => f.pass_origin === 2);
  const p2hi = p2.filter((f) => isHi(f) && isConfirmed(f)).length;
  console.log(`  ${String(r.audit_id).padEnd(34)}${String(r.pass_count ?? "?").padEnd(4)}${String(p2.length).padEnd(4)}${p2hi}`);
}
console.log("");

console.log("KILL-RULE  (N=" + N_WINDOW + " / X=" + X + ", fast-kill N=" + N_FAST + ")");
console.log(`  sample N (depth-pass runs, pass_count≥2) . ${N}  (${N >= N_WINDOW ? "≥6 MET" : "window not full"})`);
console.log(`  net-new validated P0/P1 ........... ${d1}  vs X=${X}`);
console.log(`  fast-kill (N≥3 ∧ 0 net-new ∧ 0 refute)? ${fastKill}`);
console.log(`  kill (N≥6 ∧ net-new<2)? ........... ${kill}`);
console.log("");
console.log(`  ▶ MECHANICAL VERDICT: ${mechVerdict}`);
if (mechVerdict === "KEEP" && adjudicated === 0) {
  console.log("    (advisory: refute_count is 0 because no PRIOR audit logged a refutation —");
  console.log("     the status wiring shipped 2026-06-18, so it populates as");
  console.log("     future final-audits run their 7a-ii deep-probe. KEEP rests on net-new");
  console.log("     DISCOVERY; the confirm/refute half becomes measurable as the data accrues.)");
}
console.log("══════════════════════════════════════════════════════════════════");

process.exit(0);
