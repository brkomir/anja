#!/usr/bin/env node
// expert-checks.mjs — the check-ownership registry reader (guildhall-adopt 2026-07-05).
//
// Makes the SKILL.md `checks:`/`applies_when:` frontmatter NON-inert: without a
// reader the binding is documentation nobody consults. ADVISORY by construction — it
// SUGGESTS the experts + owned checks a diff touches; the orchestrator/owner composes the
// final /expert-review panel. It is NEVER a dispatch authority: the human-in-loop panel-
// sizing + blast-radius + skepticism-diversity judgment a glob-matcher can't replicate
// stays with the orchestrator (this is why we SHIPPED the advisory lookup and DEFERRED
// guildhall's autonomous `applicable()` composer — a 3rd routing layer we don't need).
//
// Concept taken from guildhall's GuildDefinition (`applicable()` predicate +
// `deterministicChecks`) — DESIGN only, code fresh (nothing vendored).
//
// Deterministic, zero-LLM.
// Subcommands:
//   list                     — every expert + its owned checks + applies_when globs
//   orphans                  — experts declaring `checks: []` (the greppable coverage gap)
//   resolve <p1,p2,…>        — for changed paths: matched experts + the UNION of their owned checks
//   resolve --diff <range>   — same, paths from `git diff --name-only <range>`
//   --json                   — machine-readable
//   --self-test              — deterministic glob-match + frontmatter-parse guard

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SKILLS_DIR = join(ROOT, ".claude/skills");

// glob → anchored regex. `**` → any (incl. `/`); `*` → any non-`/`. Simple by design
// (advisory path-match, not a full minimatch); enough for our applies_when patterns.
function globToRe(glob) {
  const esc = glob.replace(/[.+?()[\]{}^$|\\]/g, "\\$&");
  const re = esc.replace(/\*\*/g, "\x00").replace(/\*/g, "[^/]*").replace(/\x00/g, ".*");
  return new RegExp("^" + re + "$");
}

// Parse the checks: / applies_when.paths from one SKILL.md frontmatter (regex, no YAML dep —
// matches skill-lint's approach so the two never disagree on the frontmatter shape).
function parseSkill(name) {
  const f = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(f)) return null;
  const fm = (readFileSync(f, "utf8").match(/^---\n([\s\S]*?)\n---/) || [])[1];
  if (!fm) return null;
  const listOf = (re) => {
    const b = fm.match(re);
    if (!b) return [];
    return b[1].split("\n").map((l) => (l.match(/^\s*-\s+(.+?)\s*$/) || [])[1]).filter(Boolean).map((s) => s.replace(/^["']|["']$/g, ""));
  };
  const checks = listOf(/^checks:\s*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  const paths = listOf(/^applies_when:\s*\n[ \t]+paths:\s*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  const hasChecksKey = /^checks:/m.test(fm);
  return { name, checks, paths, hasChecksKey };
}

function allSkills() {
  return readdirSync(SKILLS_DIR)
    .filter((n) => { try { return statSync(join(SKILLS_DIR, n)).isDirectory(); } catch { return false; } })
    .map(parseSkill)
    .filter((s) => s && s.hasChecksKey); // only skills that opted into the binding
}

// match a changed-path list against every expert's applies_when globs
function resolvePaths(paths) {
  const skills = allSkills();
  const matched = [];
  for (const s of skills) {
    const hits = paths.filter((p) => s.paths.some((g) => globToRe(g).test(p)));
    if (hits.length) matched.push({ name: s.name, matched_on: [...new Set(hits)], checks: s.checks });
  }
  const checksUnion = [...new Set(matched.flatMap((m) => m.checks))];
  const unmatched = paths.filter((p) => !matched.some((m) => m.matched_on.includes(p)));
  return { experts: matched.map((m) => m.name), detail: matched, checks_union: checksUnion, unmatched_paths: unmatched };
}

// ── SELF-TEST (deterministic; proves glob-match + the frontmatter parse). ──
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  let ok = true;
  const t = (name, cond) => { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };
  t("glob messages/** matches messages/de.json", globToRe("messages/**").test("messages/de.json"));
  t("glob messages/** does NOT match src/foo.ts", !globToRe("messages/**").test("src/foo.ts"));
  t("glob src/db/schema.ts is an exact literal match", globToRe("src/db/schema.ts").test("src/db/schema.ts") && !globToRe("src/db/schema.ts").test("src/db/schema.tsx"));
  t("glob src/app/**/layout.tsx matches nested", globToRe("src/app/**/layout.tsx").test("src/app/(app)/layout.tsx"));
  t("glob src/components/** matches deep", globToRe("src/components/**").test("src/components/ui/card.tsx"));
  // parse: security-expert must carry ≥1 real check + a migrations glob (proves the live parse works)
  const sec = parseSkill("security-expert");
  t("parse: security-expert has ≥1 checks + a supabase/migrations/** glob", sec && sec.checks.length >= 1 && sec.paths.some((p) => p.startsWith("supabase/migrations")));
  // resolve: a migration diff → security-expert + at least one of its owned checks
  const r = resolvePaths(["supabase/migrations/0001_init.sql"]);
  t("resolve supabase/migrations/0001_init.sql → security-expert in experts + its checks in the union", r.experts.includes("security-expert") && !!sec && sec.checks.some((c) => r.checks_union.includes(c)));
  console.log(ok ? "\nself-test: ALL PASS" : "\nself-test: FAILURES");
  process.exit(ok ? 0 : 1);
}

const asJson = args.includes("--json");
const sub = args.find((a) => !a.startsWith("--")) || "list";

if (sub === "list") {
  const skills = allSkills();
  if (asJson) { console.log(JSON.stringify(skills, null, 2)); process.exit(0); }
  console.log(`expert-checks — ${skills.length} skill(s) with a checks-ownership binding:\n`);
  for (const s of skills) {
    console.log(`${s.name}`);
    console.log(`  checks: ${s.checks.length ? s.checks.join(", ") : "[] (no owned gate yet — greppable orphan)"}`);
    console.log(`  applies_when: ${s.paths.join(", ") || "(none)"}`);
  }
} else if (sub === "orphans") {
  const orphans = allSkills().filter((s) => s.checks.length === 0);
  if (asJson) { console.log(JSON.stringify(orphans.map((s) => s.name))); process.exit(0); }
  console.log(`expert-checks orphans — ${orphans.length} expert(s) declaring \`checks: []\` (own an applies_when surface but no deterministic gate):`);
  for (const s of orphans) console.log(`  ${s.name}  (${s.paths.join(", ")})`);
  console.log(`\n(honest coverage gap — a candidate for a new sentinel test/hook, not a bug.)`);
} else if (sub === "resolve") {
  let paths = [];
  const di = args.indexOf("--diff");
  if (di >= 0 && args[di + 1]) {
    try { paths = execSync(`git diff --name-only ${args[di + 1]}`, { encoding: "utf8" }).split("\n").filter(Boolean); } catch { paths = []; }
  } else {
    const arg = args.find((a) => !a.startsWith("--") && a !== "resolve");
    paths = (arg || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!paths.length) { console.log("resolve: no paths (pass a,b,c or --diff <range>)"); process.exit(0); }
  const r = resolvePaths(paths);
  if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`expert-checks resolve — ${paths.length} changed path(s):\n`);
  console.log(`  SUGGESTED experts (ADVISORY — you compose the final panel): ${r.experts.join(", ") || "(none matched)"}`);
  for (const m of r.detail) console.log(`    ${m.name}  ← ${m.matched_on.join(", ")}${m.checks.length ? `   owns: ${m.checks.join(", ")}` : ""}`);
  console.log(`  checks_union (run these deterministic gates FIRST — feeds /expert-review --code Step 1c): ${r.checks_union.join(", ") || "(none)"}`);
  if (r.unmatched_paths.length) console.log(`  unmatched paths (no expert claims them): ${r.unmatched_paths.join(", ")}`);
} else {
  console.log(`unknown subcommand '${sub}'. Use: list | orphans | resolve <paths|--diff range>`);
  process.exit(1);
}
