// is-main.mjs — "was this module the process entry point?", answered correctly through a symlink.
//
// ⛔ THE DEFECT THIS EXISTS TO KILL, measured 2026-08-30 across 22 scripts. Node RESOLVES symlinks
// when it computes `import.meta.url`; `process.argv[1]` keeps whatever the caller typed. So the
// naive `import.meta.url === pathToFileURL(process.argv[1]).href` is FALSE whenever the script is
// reached through a symlinked path — macOS `/tmp` -> `/private/tmp`, `mktemp -d`, a symlinked
// worktree, a convenience symlink on PATH. The module then defines everything and RUNS NOTHING,
// exiting 0 with no output.
//
// The harm is not merely silence. Measured on `audit-floor-check.mjs`: by its real path it exits 1
// with 1,078 bytes of genuine finding; through a symlink it exits 0 with zero bytes. A gate whose
// non-zero rc is INVERTED into a clean pass, with nothing to see. Anything composing on rc reads
// that as success.
//
// POLARITY, and it is the whole design decision. On an undecidable entrypoint this falls back to
// the NAIVE compare, never to `false`. The repo's own written reasoning (check-lesson-numbers.mjs,
// the IS_MAIN block) is the source: "for a gate, an undecidable entrypoint must never resolve to
// don't-run". Falling back to `false` is fail-CLOSED for a library and fail-OPEN for a gate, and
// most callers here are gates. A bare REPL/`node -e` invocation (no argv[1]) is the one case that
// genuinely means library mode, and returns false.
import { pathToFileURL } from "node:url";
import { realpathSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function isMain(metaUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false; // `node -e` / REPL — genuinely not an entry point
  try {
    if (metaUrl === pathToFileURL(realpathSync(invoked)).href) return true;
  } catch {
    /* argv[1] is not a resolvable path — fall through to the naive compare, never to false */
  }
  return metaUrl === pathToFileURL(invoked).href;
}

export function selfTest() {
  let pass = 0, fail = 0;
  const ok = (m) => { pass++; console.log(`  PASS ${m}`); };
  const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
  const argv1 = process.argv[1];

  // POSITIVE: this file, invoked by its own real path, is main.
  isMain(import.meta.url) ? ok("real-path invocation reads as main")
                          : bad("real-path invocation reads as main");

  // NEGATIVE CONTROL: a different module URL must NOT read as main — without this the function
  // could return true unconditionally and still pass the arm above.
  isMain("file:///nonexistent/other-module.mjs")
    ? bad("an unrelated module URL must NOT read as main")
    : ok("an unrelated module URL must NOT read as main");

  // THE REGRESSION: a symlinked argv[1] pointing at THIS file must still read as main. Built as a
  // real symlink rather than a string, because the whole defect is a filesystem fact.
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "ismain-"));
  const link = join(dir, "linked.mjs");
  const target = new URL(import.meta.url).pathname;
  try {
    symlinkSync(target, link);
    const saved = process.argv[1];
    process.argv[1] = link;
    isMain(import.meta.url) ? ok("SYMLINKED invocation still reads as main (the regression)")
                            : bad("SYMLINKED invocation still reads as main (the regression)");
    // and the negative control must STILL be negative through the symlink
    isMain("file:///nonexistent/other-module.mjs")
      ? bad("symlinked: an unrelated module URL must NOT read as main")
      : ok("symlinked: an unrelated module URL must NOT read as main");
    // UNDECIDABLE argv[1]: falls back to the naive compare, does NOT throw, does NOT return false
    // for a path that naively matches.
    process.argv[1] = target;
    isMain(import.meta.url) ? ok("undecidable-path fallback still resolves a naive match")
                            : bad("undecidable-path fallback still resolves a naive match");
    process.argv[1] = "/definitely/not/a/real/path.mjs";
    isMain(import.meta.url) ? bad("a nonexistent argv[1] must not read as main")
                            : ok("a nonexistent argv[1] must not read as main");
    process.argv[1] = saved;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // LIBRARY MODE: no argv[1] at all.
  const saved2 = process.argv[1];
  process.argv[1] = undefined;
  isMain(import.meta.url) ? bad("no argv[1] reads as library mode") : ok("no argv[1] reads as library mode");
  process.argv[1] = saved2;

  console.log(`is-main self-test: ${pass}/${pass + fail} passed, ${fail} failed.`);
  return fail === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) {
  if (process.argv[2] === "--self-test") process.exit(selfTest());
  console.error("usage: is-main.mjs --self-test   (this module is a library; it has no other CLI)");
  process.exit(2);
}
