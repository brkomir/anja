#!/usr/bin/env node
// audit-floor-check.mjs — the self-detecting-absence net for `minimum-viable-scope:instrument-undersize`.
//
// audit-sizing-floor.mjs computes the floor at SELECTION time; this is the after-the-fact net: it reads
// the git-tracked audit-outcome ledger (.claude/logs/audit-runs.jsonl, 8b) and flags any LOGGED audit
// whose recorded mode/panel_size fell BELOW the floor its own stakes mandate. That closes the loop the
// WORK-remediable finding demands (an undersize that self-detects), catching the class the prose row
// couldn't: an under-paneled "full" audit on a high-stakes surface (e.g. a 5-expert panel on a
// revenue/paid-tier/legal/safety close, where the floor is ≥7).
//
// SCOPE + honest limit: the 8b ledger only records `full` / `--final-audit` runs (it skips --lean/--spot),
// so this net catches UNDER-PANELED logged audits + a logged weak-mode close; it CANNOT see a --lean that
// silently replaced a --final-audit (that run is never logged). That residual is covered at SELECTION time
// by the computed floor wired into /flows + /expert-review; this is the second layer, not the only one.
// Requires a `stakes` field on the ledger row (added to 8b 2026-07-12); pre-`stakes` rows are reported
// UNKNOWN (skipped), never falsely flagged (absence of data ≠ a violation).
//
// SECOND honest limit: `stakes` is self-reported — classifyRow reads row.stakes
// verbatim, so the net's floor rides on the SAME auditor's self-reported stakes declaration. The auditor
// who undersizes a paid-tier close is exactly the one who may under-declare stakes (or omit it → UNKNOWN,
// silent) — so the net INHERITS the self-assessment blind spot that produces an undersize. Fully closing it
// means a cross-check of `stakes` against the target tracker, not trusting the self-declared field —
// the selection-floor already advises the human; the net does not yet.
//
// Wired: /meta self-audit (a Check). NO_LOG: read-only, writes nothing. Self-test: --self-test.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";
import { computeFloor, HIGH_STAKES } from "./audit-sizing-floor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(ROOT, ".claude", "logs", "audit-runs.jsonl");
const STRONG_MODES = new Set(["full", "final-audit"]); // a close-grade closer (vs lean/spot/audit-check)

// The audits a recorded disposition covers (the rule: record the undersized close and move on now,
// re-audit it at floor later). Deliberately holds ONLY audit_ids — the tracker-stamp list lives in
// the disposition record and restating it here is what went stale inside 38 minutes.
const DISPOSITIONED = new Set([
  // the audit_ids your disposition record covers, one string per line
]);

/** Flagged audit_ids the disposition set does NOT cover — the computed replacement for a prose claim. */
export const undispositioned = (ids, covered = DISPOSITIONED) => ids.filter((id) => !covered.has(id));

/**
 * audit_ids retired by a later re-audit. FORWARD-ONLY: the NEW row
 * declares `supersedes: "<old_audit_id>"` (or an array) and no historical row is ever edited —
 * the same principle as a forward-only migration, and the reason this ledger stays append-only.
 *
 * Without this, an undersized close could never be cleared: a re-audit only ADDS a row while the
 * original stays flagged forever, so a done-when of "audit-floor-check returns 0 UNDERSIZED"
 * was unreachable by construction.
 *
 * ⛔ A SUPERSEDING ROW MUST ITSELF MEET ITS FLOOR. Otherwise a second too-small panel would
 * silence exactly the flag its own size earned — the failure this whole instrument exists to
 * catch, re-entering through its own exit door.
 *
 * Additive for every other reader: `audit-yield-metrics.mjs` and `calibration-score.mjs` both
 * bare-`JSON.parse` these rows with no schema validation, and neither wants latest-wins (a
 * superseded audit still happened and still found things). Verified before shipping the field.
 */
/**
 * ⭐ THE OUTCOME ROW — `records_outcome_of`. A ledger row that says a past
 * verdict was later TESTED, WITHOUT clearing anything.
 *
 * The gap it closes: this ledger records who decided and how many, and had no way to record that a
 * decision was later checked against the world. So the strongest evidence we hold — a DON'T-BUILD
 * built and killed four times on pre-registered bars — was
 * unrepresentable, and lived only in prose nobody greps.
 *
 * ⛔ IT IS NOT A SUPERSESSION AND MUST NEVER BECOME ONE. The panel-size flag measures PROCESS
 * ("was this reached by enough people?"); an outcome measures THE WORLD ("was it correct?"). Four
 * kills do not retroactively seat a seventh lens. If a good outcome could clear a process flag,
 * every under-processed decision that happened to come out right would go unrecorded, leaving
 * flagged only the under-processed decisions that ALSO failed — and the instrument would become a
 * luck-detector. Its blindness to our evidence is the property that
 * makes it worth having.
 *
 * ⛔ THE FIRST PROPOSED SHAPE WAS AN `outcome:` FIELD ON THE HISTORICAL ROW, AND THAT WOULD HAVE
 * BEEN THIS LEDGER'S FIRST APPEND-ONLY VIOLATION — the fix for "the ledger cannot record outcomes"
 * editing the one property that makes the ledger worth reading. Hence a NEW row.
 *
 * FOUR PRECONDITIONS, each measured against the reader it protects — do not drop one as decoration:
 *   1. `audit_id` + `date` are REQUIRED. `calibration-score.mjs` joins findings to dates on exactly
 *      those two fields and nothing else (`if (r.audit_id && r.date) dates.set(...)`).
 *   2. `audit_id` must be DISTINCT from the row it describes. That join is a Map and last-wins, so
 *      reusing the original id silently RE-DATES every finding of the original audit.
 *   3. NO `supersedes` key — `supersededIds` skips any row without one, so the flag stays standing.
 *   4. NO `stakes` / `panel_size` / `pass_count`. Absent `stakes`, `classifyRow` returns UNKNOWN and
 *      the row is skipped rather than flagged (absence of data ≠ a violation); absent
 *      `pass_count`, `audit-yield-metrics.mjs` excludes it from the kill-rule denominator via
 *      `(r.pass_count ?? 0) >= 2`, which is right — an outcome row is not a depth-pass run. It does
 *      still appear in that script's PER-AUDIT table with `pc` reading `?`, which is cosmetic and
 *      honest.
 */

export function supersededIds(rows, classify = classifyRow) {
  const byId = new Map(rows.map((r) => [r.audit_id, r]));
  const cleared = new Set();
  for (const row of rows) {
    if (!row.supersedes) continue;
    for (const id of [].concat(row.supersedes)) {
      const retired = byId.get(id);
      if (!retired) continue; // cannot know the bar it must clear ⇒ clear nothing
      // ⛔ THE BAR IS THE RETIRED ROW'S, NOT THE RE-AUDIT'S OWN. The flag was earned by the
      // retired row's STAKES, so grading the re-audit against whatever stakes IT happens to
      // declare lets a `stakes: []` one-expert row retire a paid-tier flag — the exit door one
      // ARGUMENT over from the panel-size guard. Union both, so neither side can under-declare
      // its way past the other.
      const stakes = [...new Set([
        ...(Array.isArray(row.stakes) ? row.stakes : []),
        ...(Array.isArray(retired.stakes) ? retired.stakes : []),
      ])];
      if (classify({ ...row, stakes }).verdict !== "OK") continue;
      cleared.add(id);
    }
  }
  return cleared;
}

// The ONE classification path — main() + selfTest() both call it.
export function classifyRow(row) {
  // NORMALISE, then REFUSE what we still do not recognise. computeFloor's HIGH_STAKES lookup is
  // exact-match, so `Premium` / `premiun` / `""` silently vanish and the row reads LOW-STAKES —
  // fail-OPEN, and supersession would turn that into a way to retire someone else's flag.
  // Lower-casing rescues the mis-cased token; an unknown one yields UNKNOWN (we genuinely cannot
  // compute a floor) rather than OK, and an UNKNOWN row can never supersede.
  // ⚠️ `none` and `""` are DECLARED no-stakes, not unknown tokens. `none` is the documented CLI
  // sentinel (expert-review 8b: `--stakes <revenue,legal,premium,safety|none>`) and 3 live ledger
  // rows carry it — measured before shipping this guard, because the strict version would have
  // silently reclassified them UNKNOWN. Check the corpus before tightening a predicate.
  const NO_STAKES = new Set(["none", ""]);
  const stakes = Array.isArray(row.stakes) ? row.stakes.map((s) => String(s).trim().toLowerCase()) : null;
  if (stakes) {
    const unknown = stakes.filter((s) => !HIGH_STAKES.has(s) && !NO_STAKES.has(s));
    if (unknown.length) {
      return { verdict: "UNKNOWN", reason: `unrecognised stakes token(s) [${unknown.join(",")}] — cannot compute a floor (known: ${[...HIGH_STAKES].join(",")}, or none)` };
    }
  }
  if (stakes === null) return { verdict: "UNKNOWN", reason: row.stakes == null
    ? "no `stakes` field (pre-2026-07-12 row) — cannot compute a floor"
    : `\`stakes\` is a ${typeof row.stakes}, not a list (${JSON.stringify(row.stakes).slice(0, 48)}) — cannot compute a floor` };
  // The ledger-check measures STAKES-adequacy of the logged audit ONLY — NOT the surface's audit
  // history (the "never-had-a-final-audit" / "≥30d stale" rules are SELECTION-time inputs, not
  // properties of a logged row; feeding them here would flag every low-stakes lean as undersized).
  // So neutralize the history rules (lastAuditDays=0 not-stale, hadFinalAudit=true) and let ONLY the
  // stakes rule drive the floor.
  const floor = computeFloor({
    stakes,
    lastAuditDays: 0,
    hadFinalAudit: true,
    diffClass: "none",
  });
  // Leading integer, for the same reason as the mode: 2 rows carry "7 (+1 validator)", which Number() reads 0.
  const panel = Number.parseInt(String(row.panel_size ?? ""), 10) || 0;
  const violations = [];
  // INERT on real data until 8b logs a lean/spot/audit-check close (today it logs only full+final-audit
  // — expert-review SKILL.md:109); kept for that future + exercised by self-test case (c) at panel≥7.
  // Ledger rows carry mode in BOTH spellings: the bare grade ("full") and the INVOCATION spelling
  // ("--final-audit", first logged 2026-09-05). STRONG_MODES holds bare forms, so an
  // un-normalised lookup read a compliant --final-audit close at panel 12 as a weak mode and
  // escalated it as UNDISPOSITIONED. Strip leading dashes before the set test; report the spelling
  // the ledger actually recorded. And grade on the LEADING TOKEN only: since 2026-10-02 panels write
  // prose into the field ("--final-audit (9 seats in two waves …)"), and a whole-string lookup read
  // three compliant final-audit closes as weak modes (measured 2026-10-05). The token ends at
  // the first character that is not a letter or hyphen, case-folded like `stakes` above: the same
  // ledger carries "Full (7 seats …)" ×3 and "full, an open design consult …" ×1.
  const gradedMode = String(row.mode ?? "").trim().toLowerCase().replace(/^-+/, "").split(/[^a-z-]/)[0];
  if (floor.closerFloor === "final-audit-required" && !STRONG_MODES.has(gradedMode)) {
    violations.push(`mode "${row.mode}" is below the final-audit floor for stakes [${stakes.join(",")}]`);
  }
  if (floor.minPanel && panel < floor.minPanel) {
    violations.push(`panel ${panel} < floor ${floor.minPanel} for stakes [${stakes.join(",")}]`);
  }
  return violations.length
    ? { verdict: "UNDERSIZED", reason: violations.join("; ") }
    : { verdict: "OK", reason: `mode ${row.mode} / panel ${panel} meets the floor for [${stakes.join(",") || "none"}]` };
}

function loadLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf-8").split("\n").filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function selfTest() {
  // One RED-control per branch (mutation-valid — remove a check in classifyRow and a case flips).
  const cases = [
    ["compliant high-stakes full ≥7 → OK",
      { audit_id: "a", mode: "final-audit", panel_size: 8, stakes: ["premium"] }, "OK"],
    ["under-paneled: 5-expert full on a paid-tier close → UNDERSIZED",
      { audit_id: "b", mode: "full", panel_size: 5, stakes: ["premium", "legal"] }, "UNDERSIZED"],
    // panel_size:8 (≥7 floor) so ONLY the weak-mode branch can make this UNDERSIZED → deleting that
    // branch flips this case RED (at panel 0 the panel branch fired too, so the
    // weak-mode branch was green-under-mutation — untested AND, since 8b never logs a weak mode, inert on real data).
    ["weak mode on high stakes: audit-check on a revenue close → UNDERSIZED",
      { audit_id: "c", mode: "audit-check", panel_size: 8, stakes: ["revenue"] }, "UNDERSIZED"],
    // DISCRIMINATING for the dash-normalisation. Case (a) above uses the BARE spelling, so it reads
    // OK with or without the fix and cannot detect the defect. This is the real logged shape: panel
    // 12 clears the ≥7 floor, so ONLY the weak-mode branch can flip it — and pre-normalisation it
    // read UNDERSIZED and surfaced as "⛔ UNDISPOSITIONED — escalate" on a compliant audit.
    ["DISCRIMINATING: dashed invocation spelling is the same strong mode → OK",
      { audit_id: "i", mode: "--final-audit", panel_size: 12, stakes: ["revenue", "legal", "safety"] }, "OK"],
    // DISCRIMINATING for the leading-token grade: panel 9 clears the ≥7 floor, so ONLY the mode
    // branch can flip it, and a whole-string lookup reads the prose-bearing spelling as a weak mode.
    ["DISCRIMINATING: prose after the mode word is the same strong mode → OK",
      { audit_id: "j", mode: "--final-audit (9 seats in two waves 4+5; 3 Fable)", panel_size: 9, stakes: ["revenue", "legal", "safety"] }, "OK"],
    // The prose names a strong mode AFTER the leading token, so an any-token grade reads it OK.
    ["DISCRIMINATING: prose after a WEAK mode word stays weak, even when it names a strong one → UNDERSIZED",
      { audit_id: "k", mode: "lean (3 seats; a full panel was not convened)", panel_size: 8, stakes: ["revenue"] }, "UNDERSIZED"],
    ["DISCRIMINATING: the ledger's capitalised, comma-joined and space-led spellings are the same strong mode → OK",
      { audit_id: "l", mode: " Full, (7 seats, one wave)", panel_size: 7, stakes: ["revenue"] }, "OK"],
    ["DISCRIMINATING: a prose panel_size grades on its leading integer → OK",
      { audit_id: "m", mode: "full", panel_size: "7 (+1 validator)", stakes: ["revenue"] }, "OK"],
    ["low-stakes lean, small panel → OK (no floor forces a full)",
      { audit_id: "d", mode: "lean", panel_size: 3, stakes: [] }, "OK"],
    ["pre-stakes historical row → UNKNOWN, never falsely flagged",
      { audit_id: "e", mode: "lean", panel_size: 2 }, "UNKNOWN"],
    // The stakes-token guard. HIGH_STAKES is exact-match, so before these three a mis-cased or
    // typo'd token silently vanished and the row read LOW-STAKES — fail-OPEN.
    ["DISCRIMINATING: a MIS-CASED high-stakes token is normalised, not dropped",
      { audit_id: "f", mode: "lean", panel_size: 2, stakes: ["Premium"] }, "UNDERSIZED"],
    ["DISCRIMINATING: an UNRECOGNISED token yields UNKNOWN, never a silent OK",
      { audit_id: "g", mode: "full", panel_size: 8, stakes: ["premiun"] }, "UNKNOWN"],
    // ⚠️ The over-strictness control, and it is not hypothetical: the first version of that guard
    // rejected `none` and would have reclassified 3 LIVE ledger rows as UNKNOWN. `none` is the
    // documented CLI sentinel, not an unknown token. This arm fails if anyone tightens it again.
    ["DISCRIMINATING (over-strictness): the `none` sentinel is a DECLARATION, not an unknown token",
      { audit_id: "h", mode: "lean", panel_size: 3, stakes: ["none"] }, "OK"],
  ];
  let fail = 0;
  console.log("=== audit-floor-check --self-test (instrument standard) ===");
  for (const [label, row, expect] of cases) {
    const got = classifyRow(row).verdict;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label} -> ${got} (expect ${expect})`);
  }
  // The anti-absorption guard. Arm B is the DISCRIMINATING one: it is the whole reason this is a
  // computed delta rather than the prose sentence it replaced. Gut `undispositioned` to `() => []`
  // and B alone flips RED — A passes under both hypotheses and proves nothing on its own.
  const COVERED = new Set(["covered-audit-a", "covered-audit-b"]);
  const covered = [...COVERED];
  const withNew = [...covered, "brand-new-undersized-2026-09-01"];
  const deltaCases = [
    ["all-covered flagged set yields no escalation (control, NOT discriminating)", covered, 0],
    ["DISCRIMINATING: a NEW undersized close is not absorbed by the covered set", withNew, 1],
  ];
  for (const [label, ids, expect] of deltaCases) {
    const got = undispositioned(ids, COVERED).length;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label} -> ${got} (expect ${expect})`);
  }
  // Supersession. S2 is the arm that matters: drop the `verdict !== "OK"` guard in supersededIds
  // and it flips to 1 — i.e. a second undersized panel would silence the flag its own size earned.
  const OLD = { audit_id: "old", mode: "full", panel_size: 5, stakes: ["premium"] };       // UNDERSIZED
  const GOOD = { audit_id: "redo", mode: "final-audit", panel_size: 8, stakes: ["premium"], supersedes: "old" };
  const SMALL = { audit_id: "redo2", mode: "full", panel_size: 4, stakes: ["premium"], supersedes: "old" };
  const supCases = [
    ["no supersedes field anywhere retires nothing (control, NOT discriminating)", [OLD], 0],
    ["DISCRIMINATING: an at-floor re-audit retires the original", [OLD, GOOD], 1],
    ["DISCRIMINATING: an UNDERSIZED re-audit retires nothing", [OLD, SMALL], 0],
    // ⛔ THE SERIOUS-DEFECT ARM. The first version graded the re-audit against ITS OWN
    // declared stakes, so this one-expert `stakes: []` row cleared a paid-tier flag — the exit door
    // one ARGUMENT over from the panel-size guard above. Revert the union in supersededIds and this
    // arm alone flips 0 -> 1.
    ["DISCRIMINATING: a `stakes: []` one-expert re-audit cannot retire a PAID-TIER flag",
      [OLD, { audit_id: "sneak", mode: "lean", panel_size: 1, stakes: [], supersedes: "old" }], 0],
  ];
  for (const [label, rows, expect] of supCases) {
    const got = supersededIds(rows).size;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label} -> ${got} (expect ${expect})`);
  }
  const total = cases.length + deltaCases.length + supCases.length;
  console.log(fail ? `FAILED: ${fail} failure(s)` : `OK: ${total} pass / 0 fail`);
  return fail ? 1 : 0;
}

// CLI only when invoked directly — NEVER on import.
if (isMainModule(import.meta.url)) {
  if (process.argv[2] === "--self-test") process.exit(selfTest());
  const rows = loadLedger();
  const retired = supersededIds(rows);
  let undersized = 0, unknown = 0, superseded = 0;
  const flags = [], flaggedIds = [];
  for (const row of rows) {
    const c = classifyRow(row);
    if (c.verdict === "UNDERSIZED") {
      // Retired by a later re-audit that met its floor. COUNTED AND REPORTED, never silently
      // dropped — a flag that vanishes without a trace is indistinguishable from a parser bug.
      if (retired.has(row.audit_id)) { superseded++; continue; }
      undersized++; flaggedIds.push(row.audit_id);
      flags.push(`  ✗ ${row.audit_id} (${row.date}, ${row.target}): ${c.reason}`);
    }
    else if (c.verdict === "UNKNOWN") unknown++;
  }
  const supersededNote = superseded ? ` · ${superseded} retired by a later at-floor re-audit` : "";
  console.log(`audit-floor-check: ${rows.length} logged audits · ${undersized} UNDERSIZED · ${unknown} pre-stakes (unknowable)${supersededNote}`);
  if (flags.length) { console.log("UNDERSIZED closes (a stakes-mandated floor was not met):"); flags.forEach((f) => console.log(f)); }
  // A flag here is a STANDING fact, not a new finding — it re-prints every run until the audit is re-run at
  // its floor. Without a pointer to the disposition, each reader re-escalates a decision the owner already made.
  //
  // ⛔ THE ANTI-ABSORPTION GUARD IS COMPUTED, NOT ASSERTED — the first version of this block stated
  // "an audit flagged above but NOT named there is UNDISPOSITIONED" as PROSE, which is a claim this
  // program makes and cannot evaluate. Not hypothetically: that same line
  // hardcoded the tracker-stamp list and went STALE WITHIN 38 MINUTES (it named four rows; five exist).
  // So the fix is two-part — DERIVE the delta, and do not restate a list this file does not own.
  // ⚠️ This is a PERMANENT fixture, not a bridge: a done-when of "returns 0 UNDERSIZED" is
  // UNREACHABLE by construction — audit-runs.jsonl is append-only with no supersession field and the
  // checker iterates every row, so a re-audit can only ADD a row while the historical undersized one
  // stays flagged forever. Closing it needs a schema decision, not another audit.
  if (flags.length) {
    const uncovered = undispositioned(flaggedIds);
    console.log("  ↪ DISPOSITION: the disposition record closes the audits it covers — no re-audit is owed for them; a flag left here stays by design.");
    console.log("     The disposition record holds the per-panel ruling — read it there, never from this line.");
    if (uncovered.length) {
      console.log(`  ⛔ UNDISPOSITIONED (${uncovered.length}) — flagged here but NOT covered by the disposition set, escalate: ${uncovered.join(", ")}`);
    } else {
      console.log(`     ✓ all ${flaggedIds.length} flagged audits are covered by the disposition set (computed, not asserted).`);
    }
  }
  process.exit(undersized > 0 ? 1 : 0);
}
