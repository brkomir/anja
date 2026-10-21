// Probe: corpus-drift routes for the regex-keyed checks. Regexes COPIED verbatim from
// scripts/skill-lint.mjs (line cited per section) because the script executes on import.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.cwd();
// 1. RULES_ROWCOUNT_DRIFT claim population (skill-lint.mjs:911-912)
const refFiles = ["CLAUDE.md", ".claude/rules/active-recall.md", ".claude/rules/behavioral-anti-patterns.md"];
for (const f of refFiles) {
  const p = join(ROOT, f);
  if (!existsSync(p)) { console.log("ROWCOUNT ref MISSING", f); continue; }
  const n = [...readFileSync(p, "utf-8").matchAll(/~?(\d+)-row catalog/g)].length;
  console.log("ROWCOUNT claims", f, "=", n);
}
console.log("RULES.md exists =", existsSync(join(ROOT, ".claude/skills/meta/RULES.md")));
// 2. NARRATIVE_COUNT_DRIFT claim population (skill-lint.mjs:956-972)
const docs = [".claude/docs/architecture.md", ".claude/docs/architecture-overview.md", ".claude/docs/state.md", "CLAUDE.md", ".claude/rules/active-recall.md", ".claude/skills/AUTHORING.md"];
const PATTERNS = [
  [/top[- ]~?(\d+)\s+most-cited/gi, "hotTier"],
  [/~?(\d+)\s+distinct\s+lessons\b/gi, "distinctLessons"],
  [/(?:of|out of)\s+~?(\d+)\s+skills\b/gi, "ofNskills"],
  [/\bat ~?(\d+)\/60\b/gi, "atN/60"],
  [/\/meta`?\s+\((\d+)\s+subcommands\)/gi, "metaSubcommands"],
];
for (const d of docs) {
  const p = join(ROOT, d);
  if (!existsSync(p)) { console.log("NARRATIVE doc MISSING", d); continue; }
  const body = readFileSync(p, "utf-8");
  console.log("NARRATIVE", d, PATTERNS.map(([re, l]) => `${l}=${[...body.matchAll(re)].length}`).join(" "));
}
// 3. CHECK_PATH_ROT — checks: forms the block regex parses vs. not (skill-lint.mjs:130)
const SK = join(ROOT, ".claude/skills");
let withChecks = 0, blockParsed = 0; const unparsed = [];
for (const n of readdirSync(SK).sort()) {
  const f = join(SK, n, "SKILL.md");
  if (!existsSync(f)) continue;
  const fm = readFileSync(f, "utf8").match(/^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  if (!/^checks:/m.test(fm[1])) continue;
  withChecks++;
  const b = fm[1].match(/^checks:\s*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  if (b) blockParsed++; else unparsed.push(`${n}: ${(fm[1].match(/^checks:.*$/m) || [""])[0]}`);
}
console.log("CHECKS skills with checks: =", withChecks, "block-parsed =", blockParsed, "unparsed =", unparsed.length);
for (const u of unparsed) console.log("  UNPARSED", u);
// 4. lesson-definition regexes over meta/MEMORY.md and its siblings (skill-lint.mjs:694, :702; raw counts, no monotonic gate)
const bulletRe = /^(\d+)\. \*\*([^*]{0,40})/gm, headerRe = /^## (?:\d{4}-\d{2}-\d{2} — )?L(\d+)[:\s(]/gm;
const metaDir = join(SK, "meta");
for (const n of readdirSync(metaDir).filter((x) => /^(MEMORY|WATCH-TIER).*\.md$/.test(x)).sort()) {
  const c = readFileSync(join(metaDir, n), "utf8");
  console.log("LESSONDEFS", n, "bullets =", [...c.matchAll(bulletRe)].length, "headers =", [...c.matchAll(headerRe)].length);
}
// 5. agents dir population (skill-lint.mjs:1005-1006)
const AG = join(ROOT, ".claude/agents");
console.log("AGENTS exists =", existsSync(AG), existsSync(AG) ? `${readdirSync(AG).filter((f) => f.endsWith(".md")).length} md files` : "");
