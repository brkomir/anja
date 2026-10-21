#!/usr/bin/env node
/**
 * staged-parse-check.mjs — SYNTAX-ONLY parse gate over blobs, not the worktree.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Nothing in this repo reads the tree being COMMITTED. `tsc` and the pre-push
 * hook both compile the WORKTREE; `private-index-commit.sh` builds a private
 * index and gates it on declared-path NAMES, a name plane that is blind to
 * content; `safe-commit.sh --staged` commits an index nobody re-read. So a green
 * `tsc` can coexist with a broken blob in the commit, and it has, twice:
 *
 *   - a `const` spliced between a declaration and its initializer;
 *   - 99 parse diagnostics in a committed blob; repaired.
 *
 * Both arrived through hunk-isolated staging (`git apply --cached`), where the
 * index and the worktree legitimately differ and every existing gate reads the
 * side that is fine.
 *
 * ── WHAT IT IS AND IS NOT ─────────────────────────────────────────────────
 *
 * PARSE only. No tsconfig, no module resolution, no type checking — it answers
 * "would the compiler's PARSER accept these bytes", which is the exact question
 * both incidents failed. A type error still belongs to `tsc`; this cannot see
 * one and does not claim to.
 *
 * The instrument is `ts.createSourceFile(...).parseDiagnostics` — the parser's
 * own output, so it carries ZERO semantic diagnostics and cannot false-positive
 * on an `isolatedModules` re-export or an unresolved import. `parseDiagnostics`
 * is not in the public typings, so its presence is ASSERTED at runtime and the
 * public `ts.transpileModule` is the documented fallback; if neither yields an
 * array the tool exits 2 (instrument failure), never 0.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/staged-parse-check.mjs --staged   <path>...   # blobs in the index
 *   node scripts/staged-parse-check.mjs --rev <ref> <path>...  # blobs at a commit
 *   node scripts/staged-parse-check.mjs --worktree <path>...   # files on disk
 *   node scripts/staged-parse-check.mjs --self-test
 *
 * `--staged` honours GIT_INDEX_FILE, so it reads a PRIVATE index when the caller
 * exported one. Exit 0 = every blob parses · 3 = at least one diagnostic ·
 * 2 = usage or instrument failure. A bare invocation exits 2, never 0.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

// The four extensions the two incidents lived in. `.js`/`.jsx` are deliberately
// OUT: a vendored or generated .js is not ours to gate and would be the first
// false positive. Widen only with a corpus measurement in hand.
const EXTS = [".ts", ".tsx", ".mts", ".mjs"];

export function isParseGated(p) {
  return EXTS.some((e) => p.endsWith(e));
}

function scriptKindFor(p) {
  if (p.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (p.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Syntax diagnostics for one blob. Returns [] for a clean parse.
 * Throws if NEITHER instrument is usable — an unusable gate must not read clean.
 */
export function parseDiagnosticsFor(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, scriptKindFor(fileName));
  const parsed = sf.parseDiagnostics;
  if (Array.isArray(parsed)) {
    return parsed.map((d) => {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      return { line: line + 1, col: character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, " ") };
    });
  }
  // Documented fallback: transpileModule is public. Restricted to the PARSER's
  // own diagnostic range so an isolatedModules complaint cannot masquerade as a
  // syntax error (the one false-positive class this gate must not have).
  const out = ts.transpileModule(text, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
  });
  if (!Array.isArray(out.diagnostics)) {
    throw new Error(
      "staged-parse-check: neither ts.createSourceFile().parseDiagnostics nor " +
      "ts.transpileModule().diagnostics returned an array. The instrument is " +
      "broken — refusing rather than reporting a clean parse.",
    );
  }
  return out.diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error && typeof d.code === "number" && d.code < 2000)
    .map((d) => {
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
      return { line: pos.line + 1, col: pos.character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, " ") };
    });
}

function blobAt(spec) {
  // rev-parse FIRST, then cat-file on the sha. `git show <rev>:<path>` on a
  // BRACKETED path with an unresolvable rev exits 0 with empty stdout and empty
  // stderr (bash-environment.md), and 63 of this repo's route files are
  // bracketed — so the natural spelling is silent on exactly our paths.
  const sha = execFileSync("git", ["rev-parse", spec], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40,}$/.test(sha)) throw new Error(`staged-parse-check: '${spec}' did not resolve to a blob (${sha})`);
  return execFileSync("git", ["cat-file", "-p", sha], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function checkPaths(paths, { mode = "staged", rev = null } = {}) {
  const findings = [];
  for (const p of paths) {
    let text;
    if (mode === "worktree") text = readFileSync(p, "utf8");
    else if (mode === "rev") text = blobAt(`${rev}:${p}`);
    else text = blobAt(`:${p}`);
    for (const d of parseDiagnosticsFor(p, text)) findings.push({ path: p, ...d });
  }
  return findings;
}

// ── self-test ────────────────────────────────────────────────────────────
// The controls are the two REAL incidents, so no arm can pass vacuously: the
// positive arm must go RED on a blob that actually shipped broken, and the
// negative arms must pass on its repair and on HEAD.
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (m) => { pass++; console.log(`  PASS ${m}`); };
  const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
  const P = "src/app/(app)/curate/[id]/page.tsx";

  // POSITIVE — the shipped break. `const` between a declaration and
  // its initializer at :871-873.
  try {
    const f = checkPaths([P], { mode: "rev", rev: "<broken-commit-id>" });
    if (f.length > 0 && f[0].line >= 869 && f[0].line <= 875) {
      ok(`POSITIVE: <broken-commit-id> blob is RED at line ${f[0].line} — ${f[0].message}`);
    } else {
      bad(`POSITIVE: <broken-commit-id> blob must be RED near :871 (got ${JSON.stringify(f)})`);
    }
  } catch (e) { bad(`POSITIVE: ${e.message}`); }

  // NEGATIVE — the repair, and HEAD. Same path, same instrument, opposite answer.
  for (const rev of ["<repair-commit-id>", "HEAD"]) {
    try {
      const f = checkPaths([P], { mode: "rev", rev });
      f.length === 0 ? ok(`NEGATIVE: ${rev} blob parses clean`) : bad(`NEGATIVE: ${rev} must parse clean (got ${JSON.stringify(f)})`);
    } catch (e) { bad(`NEGATIVE ${rev}: ${e.message}`); }
  }

  // The extension filter is a claim about which files are gated.
  const want = { "a.ts": true, "a.tsx": true, "a.mts": true, "a.mjs": true, "a.js": false, "a.jsx": false, "a.md": false, "a.sql": false };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, isParseGated(k)]));
  JSON.stringify(got) === JSON.stringify(want)
    ? ok("extension filter gates exactly .ts/.tsx/.mts/.mjs")
    : bad(`extension filter: got ${JSON.stringify(got)}`);

  // INSTRUMENT SOUNDNESS — a hand-made break must be caught, and its clean twin
  // must not. Without this the arms above only prove the tool works on one file.
  const broken = "const a: number =\nconst b = 1;\n";
  const cleanT = "const a: number = 1;\nconst b = 2;\n";
  parseDiagnosticsFor("probe.ts", broken).length > 0
    ? ok("INSTRUMENT: a synthetic splice is RED")
    : bad("INSTRUMENT: a synthetic splice must be RED");
  parseDiagnosticsFor("probe.ts", cleanT).length === 0
    ? ok("INSTRUMENT: its clean twin is not")
    : bad("INSTRUMENT: its clean twin must parse clean");

  console.log(`\nself-test: ${pass}/${pass + fail} passed, ${fail} failed.`);
  return fail === 0 ? 0 : 1;
}

// ── cli ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") process.exit(selfTest());

let mode = "staged", rev = null, i = 0;
if (argv[0] === "--staged") i = 1;
else if (argv[0] === "--worktree") { mode = "worktree"; i = 1; }
else if (argv[0] === "--rev") { mode = "rev"; rev = argv[1]; i = 2; }

const paths = argv.slice(i).filter(isParseGated);
if (paths.length === 0) {
  console.error(
    "staged-parse-check: no .ts/.tsx/.mts/.mjs path given.\n" +
    "  node scripts/staged-parse-check.mjs --staged <path>...\n" +
    "  node scripts/staged-parse-check.mjs --rev <ref> <path>...\n" +
    "  node scripts/staged-parse-check.mjs --worktree <path>...\n" +
    "  node scripts/staged-parse-check.mjs --self-test",
  );
  process.exit(2);
}

let findings;
try {
  findings = checkPaths(paths, { mode, rev });
} catch (e) {
  console.error(`staged-parse-check: ${e.message}`);
  process.exit(2);
}

if (findings.length === 0) {
  console.log(`parse gate: ${paths.length} file(s) parse clean.`);
  process.exit(0);
}
console.error(`\nREFUSE: the ${mode === "staged" ? "STAGED BLOB" : "blob"} does not parse — ${findings.length} diagnostic(s):`);
for (const f of findings) console.error(`  ${f.path}:${f.line}:${f.col}  ${f.message}`);
console.error(
  "\n  This reads the bytes being COMMITTED, not the worktree. A green `tsc` says\n" +
  "  nothing here: tsc compiles the worktree, and hunk-isolated staging is exactly\n" +
  "  where the two diverge.\n" +
  "  Re-stage the whole file, or fix the blob, then re-run.",
);
process.exit(3);
