#!/usr/bin/env node
// smoke-assert-lint.mjs — LAYER 0 of the smoke-suite mutation audit.
//
// Detects SELF-GRADING ASSERTIONS: a test that asks the SUT what it did, then grades the SUT
// against its own answer. Such an assertion RUNS, PASSES, and IS STRUCTURALLY INCAPABLE OF
// FAILING — no mutation required to find it, which is why this layer is free.
//
// THE SHAPE (found live in smoke-test-hooks.sh:534-545 on `agent-diff-reporter.sh`):
//
//     out=$(... run the SUT ...)
//     if [[ -z "$out" ]]; then
//       assert_empty   "SAFE → silent"  "$out"        # ← a DEAD SUT emits nothing, lands HERE, PASSES
//     else
//       assert_contains "FIRE → reports" "$out" "TOKEN"
//     fi
//
// The branch is chosen BY THE SUT'S OWN OUTPUT. A dead hook takes the SAFE branch every time and
// the suite stays green forever. `agent-diff-reporter` was in the suite's own "Covered:" list.
//
// WHY THIS IS A CLASS, NOT AN INCIDENT: inert guards recur. A SAFE-only
// assertion is a corpse-certifier — a hook that never fires passes every negative test. The fix is
// always the same: the expected outcome must be decided by the FIXTURE, never by the SUT.
//
// Exit 0 always (report-only). `--strict` exits 1 on any finding (for a future CI gate).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const strict = process.argv.includes("--strict");
const FILE = process.argv.find((a) => a.endsWith(".sh")) || join(REPO, "scripts/smoke-test-hooks.sh");

// SHAPE allowlist — sections whose FIRE is a VALID non-`assert_contains` shape. The shape lint keys on
// `assert_contains` (the dominant FIRE shape a dead/silent hook fails); these three legitimately use
// another shape, so a bare shape-scan false-positives them. Each was VERIFIED mutation-LIVE by
// `scripts/smoke-mutation-matrix.sh --gate` on 2026-07-13 (killed→1: killing the hook reddens ≥1
// assertion). The mutation matrix — not this static lint — is the authoritative liveness oracle; these
// are exempt HERE so the warn stays signal, not noise. A NEW death-blind section still surfaces.
//   log-memory-writes         : assert_eq "…1 log line" "1" "$diff"   (dead hook writes 0 → diff 0 → fails)
//   mail-listen-armed-marker  : if [ -f <marker> ]; then pass; else fail (dead hook writes no marker → fail)
//   mail-listen-arm-reminder  : if … | grep -q …; then pass; else fail  (dead hook silent → grep fails → fail)
// Map(name → a regex the section MUST still contain) — NOT a bare Set. A bare skip would let an
// allowlisted section DEGENERATE (lose its non-assert_contains FIRE) unnoticed. The
// required token is SPECIFIC to each section's REAL FIRE — never a generic `assert_eq` (that would
// re-admit the `assert_eq …"$?"` corpse this lint targets). Each verified mutation-LIVE by
// `scripts/smoke-mutation-matrix.sh --gate`.
const SHAPE_ALLOWLIST = new Map([
  // Tokens are SPECIFIC to each FIRE and DISTINCT from its SAFE sibling (a loose token that also matched
  // the SAFE would hide a gutted FIRE — caught by a mutation check):
  ["log-memory-writes",        /"1" "\$diff"/],                    // FIRE expects diff==1 (SAFE expects "0")
  ["mail-listen-armed-marker", /FIRE: mail-listen Monitor/],       // the FIRE pass-label (SAFE is a different marker)
  ["mail-listen-arm-reminder", /grep -q[^\n]*additionalContext/],  // the FIRE grep (SAFE uses assert_empty)
]);
// A secret-scanner must NEVER be shape-allowlisted — its FIRE must be a real assert_contains. Fail loud
// at load if one creeps in.
for (const scanner of ["validate-no-secrets", "scan-secrets-writes"]) {
  if (SHAPE_ALLOWLIST.has(scanner)) {
    console.error(`FATAL: secret-scanner ${scanner} must not be in SHAPE_ALLOWLIST (its FIRE must be assert_contains).`);
    process.exit(2);
  }
}

// ── SELF-TEST (the guard for the guard — mutation-checked; this whole tool exists because
//    a guard that cannot fail is worthless, so it must be able to fail on its own fixtures) ──
if (process.argv.includes("--self-test")) {
  let ok = true;
  const t = (n, c) => { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}`); };
  const SELF_GRADING = [
    'out=$(bash hook.sh)',
    'if [[ -z "$out" ]]; then',
    '  assert_empty "SAFE" "$out"',
    'else',
    '  assert_contains "FIRE" "$out" "TOKEN"',
    'fi',
  ].join("\n");
  const HONEST = [
    'out=$(printf "%s" "$FIXTURE" | bash hook.sh)',
    'assert_contains "FIRE on the fixture" "$out" "TOKEN"',
    'out2=$(printf "%s" "$SAFE_FIXTURE" | bash hook.sh)',
    'assert_empty "SAFE fixture stays silent" "$out2"',
  ].join("\n");
  t("detects the self-grading branch (the agent-diff-reporter shape)", findSelfGrading(SELF_GRADING).length === 1);
  t("does NOT flag an honest fixture-driven pair (no false positive)", findSelfGrading(HONEST).length === 0);
  // SHAPE invariant fixtures — the death-blind section (invokes a hook, no assert_contains FIRE) vs a
  // guarded one. This is the suite-side DELETION complement to the mutation matrix (see below).
  // Fixtures MUST match the REAL suite's header shape — `echo "=== NAME.sh ..."` (the header is inside
  // an echo, NOT at column 0). The first cut anchored on `^===`, matched ZERO real sections, and reported
  // a VOID "✅"; the mutation check (delete the FIRE, demand RED) caught it.
  const SHAPE_DEATHBLIND = [
    'echo "=== demo-2.sh (staged scan) ==="',
    'out=$(bash "$REPO/.claude/hooks/demo-2.sh" 2>&1)',
    'assert_eq "SAFE default → exit 0" "0" "$?"',   // survives KILL — a warn-mode hook always exits 0
  ].join("\n");
  const SHAPE_GUARDED = [
    'echo "=== demo-2.sh (staged scan) ==="',
    'out=$(bash "$REPO/.claude/hooks/demo-2.sh" 2>&1)',
    'assert_contains "FIRE: warns on the fixture" "$out" "WARNING"',
  ].join("\n");
  t("SHAPE: flags a hook section with no assert_contains FIRE (death-blind)", findShapeUnguarded(SHAPE_DEATHBLIND, () => true).length === 1);
  t("SHAPE: passes a section carrying an assert_contains FIRE (no false positive)", findShapeUnguarded(SHAPE_GUARDED, () => true).length === 0);
  const SHAPE_PARSE_GUARDED = [
    'echo "=== demo-2.sh (staged scan) ==="',
    'sout=$(bash "$REPO/.claude/hooks/demo-2.sh" 2>/dev/null)',
    'assert_one_json_doc "FIRE: one parseable doc, token survives" "$sout" "TOKEN"',
  ].join("\n");
  t("SHAPE: passes a section whose FIRE is assert_one_json_doc (the parse-arm form)", findShapeUnguarded(SHAPE_PARSE_GUARDED, () => true).length === 0);
  // VARIABLE-driven fixtures — the $VAR blind spot AND the .sh-less-header blind spot, TOGETHER
  // (the first cut used a `.sh`-FUL fixture header so it never replicated the real failure — the real targets
  // pre-workflow-agenttype-warn/delegate-code-review-warn have .sh-LESS headers). Header is deliberately .sh-LESS
  // here so the fixture matches reality: under the OLD `.sh`-required header regex the section isn't even parsed
  // → length 0 → this check RED (the mutation-proof); under the relaxed regex it's parsed, invokesHook resolves
  // `DVAR=".../demo-3.sh"` + `bash "$DVAR"`, and the missing assert_contains flags it.
  const SHAPE_VAR_DEATHBLIND = [
    'echo "=== demo-3 (variable-driven) ==="',      // .sh-LESS header — matches the real targets (:1512/:1543)
    'DVAR=".claude/hooks/demo-3.sh"',
    'out=$(printf "%s" "$p" | ENV=1 bash "$DVAR" 2>&1)',
    'assert_eq "SAFE default → exit 0" "0" "$?"',   // no assert_contains → death-blind, MUST be flagged now
  ].join("\n");
  const SHAPE_VAR_GUARDED = [
    'echo "=== demo-3 (variable-driven) ==="',      // .sh-LESS header
    'DVAR=".claude/hooks/demo-3.sh"',
    'out=$(printf "%s" "$p" | bash "$DVAR" 2>&1)',
    'assert_contains "FIRE: warns on the fixture" "$out" "WARNING"',
  ].join("\n");
  t("SHAPE: flags a VARIABLE-driven ($VAR) death-blind section (the :192 blind spot)", findShapeUnguarded(SHAPE_VAR_DEATHBLIND, () => true).length === 1);
  t("SHAPE: passes a VARIABLE-driven section carrying an assert_contains FIRE", findShapeUnguarded(SHAPE_VAR_GUARDED, () => true).length === 0);
  console.log(ok ? "\nself-test: ALL PASS" : "\nself-test: FAILURES");
  process.exit(ok ? 0 : 1);
}

// ── --shape: the suite-side DELETION complement to smoke-mutation-matrix.sh --gate ──────────────
// The mutation gate fires on HOOK diffs. It does NOT see a suite-side edit that DELETES a hook's only
// FIRE assertion on an UNCHANGED hook — the suite stays green (fewer ✓), and no hook changed to trigger
// the gate. This static check catches that class: a `=== <hook>.sh ===` section that INVOKES the hook
// but carries ZERO content-FIRE assertion (`assert_contains`) is the death-blind shape (a section
// checking only existence + exit-0). Recomputed every run → stale-proof. Report-only;
// exits 1 only with --strict. WARN-mode in the suite until an observation window sets the FP rate.
// CAVEAT (accepted, warn-mode): the section header is a LOCATOR not an owner (a FIRE assert can live in
// a sibling section), and a hook whose FIRE is an exact assert_eq (not assert_contains) reads as an FP.
// The mutation matrix is the authoritative liveness oracle; this is the cheap early-warning complement.
if (process.argv.includes("--shape")) {
  const src = readFileSync(FILE, "utf8");
  const findings = findShapeUnguarded(src);
  console.log(`smoke-shape-lint — ${FILE.replace(REPO + "/", "")}`);
  if (!findings.length) {
    console.log("  ✅ every hook section that invokes its hook carries an assert_contains FIRE");
    process.exit(0);
  }
  console.log(`\n⚠️  ${findings.length} hook section(s) invoke a hook with NO assert_contains FIRE (death-blind shape):\n`);
  for (const f of findings) {
    console.log(`  SHAPE-UNGUARDED  ${f.name}.sh  (smoke-test-hooks.sh:${f.line})`);
    console.log(`      ↳ the section runs the hook but only checks existence/silence — a DEAD hook passes it.`);
    console.log(`      ↳ FIX: add an assert_contains that greps the hook's FIRE output, or an assert_one_json_doc parse arm (a dead hook is silent → fails).`);
  }
  process.exit(strict ? 1 : 0);
}

// The detector. A finding = an `if` whose CONDITION tests a variable V, where an `assert_*` INSIDE
// that if/else asserts on the SAME V. That is the tell: the SUT's output is picking the expectation.
function findSelfGrading(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // NOTE `[^\]]` — the `]` MUST be escaped. In JavaScript `[^]` is a VALID char class meaning
    // ANY character, so an unescaped `[^]]*?` parses as `[^]*?` + a literal `]` and demands a `]`
    // immediately before the `$`. The first cut had that bug: the lint reported "no self-grading
    // assertions" on a suite that provably has one, and its own self-test caught it in one run.
    const m = lines[i].match(/^\s*if\s+\[\[?\s*[^\]]*?\$\{?(\w+)\}?/);
    if (!m) continue;
    const v = m[1];
    // walk the if-block to its `fi` (bounded — these blocks are short)
    let depth = 1, asserts = [], sawElse = false;
    for (let j = i + 1; j < lines.length && j < i + 40; j++) {
      const l = lines[j];
      if (/^\s*if\s/.test(l)) depth++;
      if (/^\s*fi\b/.test(l)) { depth--; if (depth === 0) break; }
      if (depth === 1 && /^\s*else\b/.test(l)) sawElse = true;
      const a = l.match(/^\s*(assert_\w+)\s+/);
      if (a && new RegExp(`\\$\\{?${v}\\}?`).test(l)) asserts.push({ line: j + 1, fn: a[1], text: l.trim() });
    }
    // Self-grading iff the branch condition reads V and an assertion inside is ABOUT V.
    // The `else` makes it definitive (two expectations, chosen by the subject), but a single
    // guarded assert on V is the same disease: the SUT decides whether it gets checked at all.
    if (asserts.length) out.push({ line: i + 1, var: v, hasElse: sawElse, asserts });
  }
  return out;
}

// A hook SECTION (`=== <name>.sh ... ===`) that actually RUNS its hook but carries no `assert_contains`
// FIRE. The two signals: `invokes` requires a real `bash <...>/<name>.sh` run (a bare comment mention
// does not count); `hasFire` requires an `assert_contains` (a content assertion a silent/dead hook
// FAILS — unlike `assert_eq …"0"…"$?"`, which a warn-mode corpse passes). See the --shape header above
// for why section == locator (accepted under warn-mode).
// Does this section body actually RUN its hook? Two invocation shapes:
//   (a) literal path on one line:            `bash [...]/<name>.sh`
//   (b) VARIABLE path (the :192 blind spot): `VAR=".../<name>.sh"` … then `bash [ENV=x ] "$VAR"`
// Without (b), a section that assigns the hook path to a var and invokes `bash "$VAR"` (the literal name
// never appears after `bash`) reads invokes=false and is SILENTLY SKIPPED — so deleting its only FIRE
// assertion would go unlinted. Two live sections do exactly this: pre-workflow-agenttype-warn (`$WAHK`,
// smoke-test-hooks.sh:1517/1523) and delegate-code-review-warn (`DELEGATE_REVIEW_FAKE_PEERS=2 bash "$DCRW"`,
// :1547/1550). Resolving the assignment adds a LOCATOR only — no ownership semantics (that stays the
// mutation matrix's job); a name is `[A-Za-z0-9_-]+` (header regex), literal in these patterns.
// BOUNDARY (Rule-of-Three: marked, not built; only the `bash "$VAR"` shape has ≥2 instances).
// invokesHook still does NOT resolve: a bare `"$VAR"`/`$VAR` invocation with no `bash` (e.g. an exec'd hook);
// `source "$VAR"` / `. "$VAR"`; or a two-hop assignment (`A="$VAR"; bash "$A"`). The next author adding one of
// those to the suite must extend branch (b) — and, per the file's own :87 discipline, give the new shape a
// fixture whose HEADER matches the real target's shape.
function invokesHook(body, name) {
  if (new RegExp(`bash\\s+[^\\n]*${name}\\.sh`).test(body)) return true;   // (a) literal path after bash
  const m = body.match(new RegExp(`^\\s*(\\w+)=["']?[^"'\\n]*${name}\\.sh`, "m"));   // (b) VAR=".../<name>.sh"
  return !!(m && new RegExp(`bash\\s+["']?\\$\\{?${m[1]}\\b`).test(body));           //     + bash [env] "$VAR"
}

function findShapeUnguarded(src, hookExists = (name) => existsSync(join(REPO, ".claude/hooks", `${name}.sh`))) {
  const lines = src.split("\n");
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    // Section headers in the suite SOURCE are `echo "=== NAME[.sh] ..."`. `.sh` is OPTIONAL: the real suite's
    // hook-section headers are INCONSISTENT — some carry `.sh` (=== validate-no-secrets.sh …), others do NOT
    // (=== pre-workflow-agenttype-warn …, smoke-test-hooks.sh:1512; === delegate-code-review-warn …, :1543).
    // Requiring `.sh` EXCLUDED the .sh-less sections at parse time — one layer BEFORE invokesHook runs — so the
    // VAR-resolution fix was INERT on its own two targets (mutation-proven: delete their FIRE and
    // --shape stayed green). invokesHook (below) is the real hook-section filter, so admitting a non-hook .sh-less
    // header here is harmless — it fails invokesHook and is skipped. Match the echo form, `.sh` optional.
    const h = lines[i].match(/^\s*echo\s+"===\s+([A-Za-z0-9_-]+)(?:\.sh)?\b/);
    if (h) { if (cur) sections.push(cur); cur = { name: h[1], line: i + 1, body: [] }; continue; }
    if (cur) cur.body.push(lines[i]);
  }
  if (cur) sections.push(cur);
  const out = [];
  for (const s of sections) {
    const body = s.body.join("\n");
    // Is this section actually a HOOK section? The relaxed .sh-OPTIONAL header regex now parses NON-hook
    // sections too — e.g. `=== session-mail engine smoke (…scripts/smoke-test-session-mail.sh) ===`, where no
    // .claude/hooks/session-mail.sh exists yet invokesHook substring-matches session-mail.sh inside
    // smoke-test-session-mail.sh. Gate on the hook file's existence (the matrix's own `[ -f .claude/hooks/$stem.sh ]`
    // test — the real "is this a hook" filter the `.sh`-in-header used to crudely proxy). Injectable so the
    // self-test's synthetic demo hooks (which have no real file) still exercise the shape logic.
    if (!hookExists(s.name)) continue;
    if (SHAPE_ALLOWLIST.has(s.name)) {
      // Allowlisted: skip ONLY while its SPECIFIC non-assert_contains FIRE is still present. If it
      // degenerated (lost that token), flag it — a bare skip would hide a corpse in an allowlisted section.
      if (SHAPE_ALLOWLIST.get(s.name).test(body)) continue;
      out.push({ name: s.name, line: s.line, degenerated: true });
      continue;
    }
    if (!invokesHook(body, s.name)) continue;      // a section that never runs the hook is not a shape claim
    // assert_one_json_doc is a content-FIRE too: whole-stdout json.loads + a token that must survive; a dead
    // hook reads EMPTY and fails it (the parse-arm form the population row adds per hook).
    if (!/assert_contains|assert_one_json_doc/.test(body)) out.push({ name: s.name, line: s.line });
  }
  return out;
}

const src = readFileSync(FILE, "utf8");
const findings = findSelfGrading(src);

console.log(`smoke-assert-lint — ${FILE.replace(REPO + "/", "")}`);
if (!findings.length) {
  console.log("  ✅ no self-grading assertions (no test grades the SUT against the SUT's own answer)");
  process.exit(0);
}

console.log(`\n⚠️  ${findings.length} SELF-GRADING assertion site(s) — these RUN, PASS, and CANNOT FAIL:\n`);
for (const f of findings) {
  console.log(`  smoke-test-hooks.sh:${f.line}  branch on $${f.var}${f.hasElse ? " (with else — definitive)" : ""}`);
  for (const a of f.asserts) console.log(`      :${a.line}  ${a.fn} on $${f.var} → ${a.text.slice(0, 78)}`);
  console.log(`      ↳ the SUT's own output picks the expectation. A DEAD SUT takes the silent branch and PASSES.`);
  console.log(`      ↳ FIX: the expected outcome must come from the FIXTURE, never from the SUT.\n`);
}
process.exit(strict ? 1 : 0);
