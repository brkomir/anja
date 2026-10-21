/**
 * project-key.mjs — the harness's per-project directory name, derived ONE way for the whole repo.
 *
 * Claude Code keys a project's transcripts, memory and tool-results under
 * `~/.claude/projects/<key>/`. Four scripts derived <key> each their own way (session-labels.py,
 * session-lifecycle.py, setup-project-memory.sh, agent-memory-load-audit.mjs) from three different
 * roots (`__file__`, `--git-common-dir`, a literal), and none carried the harness's over-200 branch.
 * This module and `scripts/session_status.py` (`project_key` / `repo_root` / `project_key_dir`) are
 * the two ports of the ORACLE, read from the installed harness binary 2.1.296
 * (`~/.local/share/claude/versions/2.1.296`, a Bun-compiled bundle; byte offsets 187113178 and
 * 188799463, where the next reader can compare it against a newer binary; in that build the hash is
 * the function `Use`, the 200-unit limit the constant `Ipe` and the key the function `DO`, the names
 * the comments below use). The rule, in words:
 *
 *   1. root = the directory the session started in, resolved to its real path, NFC-normalized;
 *   2. key = root with every UTF-16 code unit outside [a-zA-Z0-9] replaced by "-";
 *   3. a key of 200 units or fewer is the answer; a longer one is cut to its first 200 units and
 *      suffixed with "-" + base36(|h|), where h is a 32-bit hash of the ORIGINAL root
 *      (h = h*31 + unit, wrapping at 32 bits, the same arithmetic as Java's String.hashCode);
 *   4. a name in CLAUDE_CODE_PROJECT_DIR_NAME overrides all of it, honoured only when
 *      CLAUDE_CONFIG_DIR is set.
 *
 * Two consequences the old sites got wrong, neither live today (all 72 real keys are ASCII, the
 * longest 125 units): the regex runs per UTF-16 unit, so a character outside the BMP becomes TWO
 * dashes (Python's re.sub gave one); and a key over 200 units is cut to 200 and suffixed with
 * `-` + base36(|hash(root)|), where the hash runs over the ORIGINAL root, never the sanitized key.
 *
 * ROOT. The harness keys on the realpath'd, NFC-normalized cwd the session started in; in this
 * fleet that is the MAIN checkout even for a seat working inside a linked worktree (measured:
 * 5,330 worktree-cwd records under the main-checkout key, no worktree-keyed dir). So
 * `repoRoot()` takes the parent of `git rev-parse --path-format=absolute --git-common-dir`, which
 * names the main repository from any worktree, and falls back to the cwd given (else this file's repository) when git cannot answer.
 *
 * NOT IMPLEMENTED, by name: the `CLAUDE_CODE_PROJECT_DIR_NAME` override (step 4), which the harness
 * honours only when `CLAUDE_CONFIG_DIR` is set, and a non-default `CLAUDE_CONFIG_DIR` itself — no
 * caller in this repo honours either, so `projectKeyDir` keeps `~/.claude/projects`.
 *
 * CLI (for the bash caller, setup-project-memory.sh):
 *   node scripts/lib/project-key.mjs --key  [--root <path>]   print <key>  (root: as given, else repoRoot())
 *   node scripts/lib/project-key.mjs --dir  [--root <path>]   print ~/.claude/projects/<key>
 *   node scripts/lib/project-key.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./is-main.mjs";

/** The harness's `Ipe`. */
export const PROJECT_KEY_MAX = 200;

/** `Use(t)`: h = h*31 + charCodeAt(i), wrapped to a signed int32, over UTF-16 units. */
export function harnessStringHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

/** `DO(e)`: sanitize per UTF-16 unit; over 200 units, cut and suffix with base36(|hash(root)|). */
export function projectKey(root) {
  const key = root.replace(/[^a-zA-Z0-9]/g, "-");
  if (key.length <= PROJECT_KEY_MAX) return key;
  return `${key.slice(0, PROJECT_KEY_MAX)}-${Math.abs(harnessStringHash(root)).toString(36)}`;
}

// The default anchor is THIS file, never the process cwd: a caller run from /tmp or another repo
// must still name this repository (the literal keys the helper replaces were cwd-independent).
const LIB_DIR = dirname(fileURLToPath(import.meta.url));

/** The MAIN checkout's root as the harness keys it: parent of the git common dir, realpath'd, NFC. */
export function repoRoot(cwd) {
  const base = cwd ?? LIB_DIR;
  let root;
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    root = common ? dirname(common) : (cwd ?? resolve(LIB_DIR, "..", ".."));
  } catch {
    root = cwd ?? resolve(LIB_DIR, "..", "..");
  }
  try {
    root = realpathSync(root);
  } catch {
    root = resolve(root);
  }
  return root.normalize("NFC");
}

/** `<home>/.claude/projects/<projectKey(root)>`. `root` is used as given — pass `repoRoot()` output. */
export function projectKeyDir(root = repoRoot(), home = homedir()) {
  return join(home, ".claude", "projects", projectKey(root));
}

// Pinned from the harness's own DO()/Use() on these exact strings (scratch run, 2026-10-10), so the
// arms below test against the ORACLE and not merely against this file's reading of it.
const FX230 = "/tmp/" + "x".repeat(225);
const FX230_KEY = "-tmp-" + "x".repeat(195) + "-qled2p";
const FX201 = "/" + "y".repeat(200);
const FX200 = "/" + "y".repeat(199);
const FX_NEG = "/n/" + "z".repeat(220) + "0"; // Use() < 0 here: the Math.abs leg

export function selfTest() {
  let pass = 0, fail = 0;
  const arm = (name, ok, got) => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  };
  arm("a dot becomes a dash",
    projectKey("/a/b.c") === "-a-b-c" && projectKey("/a/my_repo x/caf\u00e9") === "-a-my-repo-x-caf-" && projectKey("/path/to/repo") === "-path-to-repo",
    [projectKey("/a/b.c"), projectKey("/path/to/repo")]);
  arm("a non-BMP character yields two dashes (UTF-16 units)",
    projectKey("/a/\u{1F4F7}b") === "-a---b", projectKey("/a/\u{1F4F7}b"));
  arm("the hash is the harness's int32 string hash",
    harnessStringHash("") === 0 && harnessStringHash("a") === 97 && harnessStringHash("ab") === 3105
      && harnessStringHash(FX230) === 1608062641 && harnessStringHash(FX_NEG) === -809379136,
    [harnessStringHash(""), harnessStringHash("a"), harnessStringHash("ab"), harnessStringHash(FX230), harnessStringHash(FX_NEG)]);
  arm("a 230-character path takes the oracle's suffix", projectKey(FX230) === FX230_KEY, projectKey(FX230));
  arm("a negative hash takes Math.abs (the suffix never carries a sign)",
    projectKey(FX_NEG).slice(PROJECT_KEY_MAX) === "-ddvsxs", projectKey(FX_NEG).slice(PROJECT_KEY_MAX));
  arm("200 units is the last unsuffixed length and 201 is suffixed",
    projectKey(FX200).length === 200 && projectKey(FX200) === FX200.replace("/", "-")
      && projectKey(FX201).length === 207 && projectKey(FX201).slice(PROJECT_KEY_MAX) === "-a066hd",
    [projectKey(FX200).length, projectKey(FX201).length, projectKey(FX201).slice(PROJECT_KEY_MAX)]);
  arm("projectKeyDir joins <home>/.claude/projects/<key>",
    projectKeyDir("/a/b.c", "/h") === join("/h", ".claude", "projects", "-a-b-c"), projectKeyDir("/a/b.c", "/h"));

  // A THROWAWAY repo under mktemp — never this repository — with one linked worktree.
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "project-key-"));
  try {
    const main = join(dir, "main");
    mkdirSync(main);
    const git = (args, cwd) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git(["init", "-q"], main);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], main);
    const wt = join(dir, "wt");
    git(["worktree", "add", "-q", "--detach", wt, "HEAD"], main);
    const fromMain = repoRoot(main), fromWt = repoRoot(wt);
    arm("the root from a linked worktree equals the main root",
      fromWt === fromMain && fromMain === realpathSync(main), { fromMain, fromWt });
    arm("a directory outside any repo falls back to itself",
      repoRoot(dir) === realpathSync(dir), repoRoot(dir));
    const fromElsewhere = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--key"], { cwd: dir, encoding: "utf8" }).trim();
    arm("the default root is this file's repository, whatever the cwd",
      fromElsewhere === projectKey(repoRoot(LIB_DIR)) && fromElsewhere !== projectKey(realpathSync(dir)), fromElsewhere);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`self-test: ${fail ? `${fail} FAILED` : "ALL PASS"} (${pass}/${pass + fail})`);
  return fail ? 1 : 0;
}

const USAGE = "usage: project-key.mjs --key [--root <path>] | --dir [--root <path>] | --self-test   (a mode is REQUIRED; bare invocation exits 2)";

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--root");
  const root = i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  if (args.includes("--self-test")) process.exit(selfTest());
  else if (args.includes("--key")) process.stdout.write(projectKey(root ?? repoRoot()) + "\n");
  else if (args.includes("--dir")) process.stdout.write(projectKeyDir(root ?? repoRoot()) + "\n");
  else {
    console.error(USAGE);
    process.exit(2);
  }
}
