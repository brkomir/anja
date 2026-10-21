// Fixture rig: runs the REAL scripts/skill-lint.mjs (copied, so ROOT resolves to the fixture) against a
// stub sub-process and a minimal tree. Every silent arm has a positive-control arm beside it.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
const [REPO, STUB, F] = process.argv.slice(2);
if (!REPO || !STUB || !F) { console.error("usage: node rig.mjs <repo> <stub architecture-counts.mjs> <fixture dir>"); process.exit(2); }
// F is deleted recursively, so delete only a directory this rig made (it carries MARK) or none at all.
const MARK = ".skill-lint-rig-fixture";
if (existsSync(F) && !existsSync(join(F, MARK))) { console.error(`refusing: ${F} exists and carries no ${MARK}, so this rig did not make it`); process.exit(2); }
rmSync(F, { recursive: true, force: true });
const w = (p, s) => { mkdirSync(dirname(join(F, p)), { recursive: true }); writeFileSync(join(F, p), s); };
mkdirSync(join(F, "scripts"), { recursive: true });
writeFileSync(join(F, MARK), "");
copyFileSync(join(REPO, "scripts/skill-lint.mjs"), join(F, "scripts/skill-lint.mjs"));
copyFileSync(STUB, join(F, "scripts/architecture-counts.mjs"));
w(".claude/hooks/warn-large-tracker-read.sh", "TRACKER_THRESHOLD=51200\n");
w(".claude/skills/meta/SKILL.md", "---\nname: meta\ndescription: Use when auditing the expert system health.\n---\n# meta\n");
w(".claude/skills/meta/RULES.md", "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n"); // 4 pipe-space lines - 1 separator = 3 rows
w(".claude/skills/meta/MEMORY.md", "# meta MEMORY (router)\n\nno lesson definitions here\n");
w(".claude/docs/architecture.md", "This doc covers 1 of 120 skills.\n"); // ssot 107, band ok, drift 13 > 5
w("CLAUDE.md", "RULES.md is a ~50-row catalog.\n"); // actual 3, drift 47 > 5
w(".claude/project-memory/x.md", "hello\n");
w(".claude/agents/orphan.md", "---\nname: orphan\ndescription: x\n---\n");

const run = (args, mode = "clean") => {
  const r = spawnSync(process.execPath, ["scripts/skill-lint.mjs", ...args], { cwd: F, encoding: "utf8", env: { ...process.env, STUB_MODE: mode } });
  let units = null;
  try { units = JSON.parse(r.stdout); } catch { /* no JSON */ }
  return { rc: r.status, units, stderrLines: r.stderr.split("\n").filter(Boolean).length, stderr: r.stderr };
};
const show = (arm, res, unitName) => {
  const u = res.units?.find((x) => x.name === unitName);
  const codes = u ? u.findings.map((f) => f.code) : ["<unit missing>"];
  const marker = u ? u.findings.filter((f) => /UNSCANNED|UNMEASURED|cannot/i.test(f.msg)).length : 0;
  const extra = u && u.filesByRoot ? ` filesByRoot=${JSON.stringify(u.filesByRoot)}` : "";
  console.log(`${arm.padEnd(46)} rc=${res.rc} findings=${String(codes.length).padStart(2)} marker=${marker} stderr=${res.stderrLines}  [${[...new Set(codes)].join(",")}]${extra}`);
};
console.log("== A. lintArchitectureDoc vs the sub-process's five finding classes (unit: architecture.md)");
for (const m of ["clean", "count-drift", "banner-drift", "listing-count", "listing-missing", "listing-extra", "appx-c", "anchor-rot", "crash"]) show(`arch STUB_MODE=${m}`, run(["arch", "--json"], m), "architecture.md");
console.log("== B. lintNarrativeCountRefs (unit: narrative count refs) — doc claims 'of 120 skills', ssot 107");
for (const m of ["clean", "list-renamed-key", "list-crash"]) show(`meta STUB_MODE=${m}`, run(["meta", "--json"], m), "narrative count refs");
console.log("== C. lintRulesRowCountRefs (unit: RULES.md row-count refs) — RULES.md has 3 rows");
show("meta CLAUDE.md='~50-row catalog' (control)", run(["meta", "--json"]), "RULES.md row-count refs");
w("CLAUDE.md", "RULES.md is a catalog of ~50 rows.\n");
show("meta CLAUDE.md reworded 'catalog of ~50 rows'", run(["meta", "--json"]), "RULES.md row-count refs");
w("CLAUDE.md", "RULES.md is a ~50-row catalog.\n");
rmSync(join(F, ".claude/skills/meta/RULES.md"));
show("meta RULES.md deleted (SSOT gone)", run(["meta", "--json"]), "RULES.md row-count refs");
w(".claude/skills/meta/RULES.md", "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n");
console.log("== D. lintMetaMemoryNumbering (unit: meta (MEMORY numbering))");
w(".claude/skills/meta/MEMORY.md", "5. **alpha** x\n5. **beta** y\n");
show("meta MEMORY.md with 2 bullets both L5 (control)", run(["meta", "--json"]), "meta (MEMORY numbering)");
w(".claude/skills/meta/MEMORY.md", "# meta MEMORY (router)\n\nno lesson definitions here\n");
show("meta MEMORY.md router, 0 defs (live shape)", run(["meta", "--json"]), "meta (MEMORY numbering)");
rmSync(join(F, ".claude/skills/meta/MEMORY.md"));
show("meta MEMORY.md deleted (SSOT gone)", run(["meta", "--json"]), "meta (MEMORY numbering)");
w(".claude/skills/meta/MEMORY.md", "# meta MEMORY (router)\n");
console.log("== E. lintAgentSkillPairing (unit: agent-skill pairing) — full-corpus run");
show("full, agents/orphan.md present (control)", run(["--json"]), "agent-skill pairing");
rmSync(join(F, ".claude/agents"), { recursive: true });
show("full, .claude/agents DELETED", run(["--json"]), "agent-skill pairing");
w(".claude/agents/orphan.md", "---\nname: orphan\ndescription: x\n---\n");
console.log("== F. lintMemoryEnvelopes statSync skip (unit: memory envelope debris) — full-corpus run");
show("full, skills root 0755 (control)", run(["--json"]), "memory envelope debris");
chmodSync(join(F, ".claude/skills"), 0o444);
let canStat = true; try { statSync(join(F, ".claude/skills/meta")); } catch { canStat = false; }
if (canStat) console.log("full, skills root 0444: SKIPPED — this process can still stat children");
else show("full, skills root 0444 (readdir ok, stat EACCES)", run(["--json"]), "memory envelope debris");
chmodSync(join(F, ".claude/skills"), 0o755);
