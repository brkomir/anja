#!/usr/bin/env node
// Stage only YOUR changed hunks of a file another session is also editing.
//
//   node scripts/stage-own-hunks.mjs <path> --key <text> [--key <text> ...]
//        [--exclude <text> ...] [--expect +ADDED/-REMOVED] [--strict] [--key-in-removed]
//        [--dry-run] [--allow-numstat-mismatch=+ADDED/-REMOVED]
//   node scripts/stage-own-hunks.mjs --self-test
//
// It reads `git diff -U0 HEAD -- <path>` (worktree against HEAD), keeps the hunks whose ADDED
// lines contain one of your --key strings (fixed-string match; --key-in-removed also matches
// removed lines, which you need for a hunk that only deletes), applies ONLY those hunks to
// HEAD's copy of the file, and stages the result as a blob (hash-object -w + update-index
// --cacheinfo, with the file mode read from HEAD's tree). The worktree is never touched, so
// the other session's lines stay where they are. File bytes are handled as raw bytes, so a
// non-UTF-8 file is staged byte for byte. The path may be given from any subdirectory.
//
// Then commit with `scripts/safe-commit.sh --staged` (it will ask for --drift-ok, because the
// index now differs from the worktree by exactly the hunks you left out; check both drift
// axes first, as its refusal text says).
//
// The strongest check is --expect: you state how many lines YOUR edit adds and removes, and it
// refuses when the kept hunks differ. It sees another session's line inside a kept hunk (an
// adjacent added line, a deleted line next to or near yours) and one of your deletions landing
// in their hunk. With one pair it compares totals, so one of their lines taken in while one of
// yours of the same sign is left out (a deletion of yours with no key, say) still matches: read
// the "left out" lines it prints, and every one should be theirs. Use it whenever you can count.
//
// It REFUSES, and stages nothing, when:
//   - a git child does not finish within the timeout (60 s; STAGE_OWN_HUNKS_GIT_TIMEOUT_MS
//     overrides it, for one call shape only when STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB names its verb or verb and first argument): the child is killed and the verb named — its `hash-object` has hung idle
//     three times, intermittently. The one exception to "stages nothing": a stall at
//     update-index or after it can leave the blob staged, so that refusal says to read
//     `git diff --cached --name-only`;
//   - the path already has something staged, before the run or during it;
//   - the path is not a regular file in HEAD and in the worktree (a new file: `git add` it; a
//     deleted one: `git rm` it; a symlink or a type change: stage it by hand), or the diff
//     names more than one file;
//   - a --key matches no hunk (a stale or mistyped key);
//   - the kept hunks' +/- differ from --expect;
//   - a kept hunk also contains an --exclude string (a phrase from THEIR line);
//   - under --strict: a kept added line carries none of your keys, or a kept hunk removes more
//     lines than it adds unless EVERY removed line in it carries one of your keys (and
//     --key-in-removed is set). Removed lines carry no owner. --strict cannot see another
//     session's deletion in a kept hunk that adds at least as many lines as it removes (+1 -1,
//     +2 -1); --expect plus the "left out:" lines it prints are what cover that. Every run
//     prints the unkeyed-added count per hunk, so read it, and read each hunk's -N;
//   - the result changes how often an --exclude string appears (only reachable for an
//     --exclude that spans a line break; a single-line one is caught by the check above);
//   - a selected hunk carries a "no newline at end of file" marker;
//   - the staged blob's line count against HEAD differs from the kept hunks' count, unless
//     --allow-numstat-mismatch names that exact pair (read the diff it prints first). This is
//     checked before --dry-run returns, so a dry run refuses what the real run refuses;
//   - HEAD moves while it runs. If HEAD moves AFTER the blob is staged, it unstages the path
//     and refuses, because a blob built on the old HEAD would revert the new commit, unless the
//     path was restaged by someone else meanwhile. If another session restages the path right
//     after the write, it refuses and leaves their blob, whether or not HEAD also moved (save
//     the one-spawn window under Residual windows).
//
// Residual windows: a peer stage landing in the one git process between the last stage check
// and the write is REPLACED by yours (their worktree is untouched); the read-back catches only a
// write after ours. A HEAD move after the final HEAD check, and everything after this tool
// exits, are not seen. Nor is a peer restage landing in the one spawn between the HEAD-moved
// branch's index read and its unstage: that restage is unstaged with ours (git has no
// compare-and-swap on an index entry). Compare `git rev-parse HEAD` to the value this prints
// before committing. A symlink in the worktree: a dangling one is refused by name; one to
// an existing file passes isFile and is refused by the two-file guard (it diffs as two files).
//
// Keys match as substrings, so pick one that no ordinary word contains (`MINE` is inside
// `DETERMINE`), or give it a leading space.
//
// --expect with ONE pair compares totals. Git can line up a repeated line (a blank, a closing
// brace) across your hunk and another session's, moving a deletion between them while the totals
// still match (measured 2 in 250). With SEVERAL pairs, `--expect +2/-1,+0/-2`, it compares each
// kept hunk's counts IN FILE ORDER (as a set, git can swap two hunks' shapes and still match); derive them from a diff of HEAD against a copy holding only your
// edit, and it must be THIS diff: `git diff --no-index -U0 --diff-algorithm=myers
// --inter-hunk-context=0 <head-copy> <your-copy>`. Git's default -U3 merges nearby hunks into one
// pair, and one pair is a totals check again (measured: the 4-line repro B passes as +1/-1).
// Where your removed lines carry your key, `--key-in-removed --expect` measured 0 wrong in 250.
//
// Keys select whole hunks. Read the printed hunk list before committing: a hunk can hold
// more than your edit, and only you know which lines are yours.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, writeFileSync, rmSync, realpathSync, statSync, unlinkSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `usage: node scripts/stage-own-hunks.mjs <path> --key <text> [--key <text> ...] [--exclude <text> ...]
         [--expect +ADDED/-REMOVED[,+ADDED/-REMOVED ...]] [--strict] [--key-in-removed] [--dry-run]
         [--allow-numstat-mismatch=+ADDED/-REMOVED]
       node scripts/stage-own-hunks.mjs --self-test`;

// The algorithm is pinned: a user's diff.algorithm=histogram makes the blob-vs-HEAD line count
// differ from the kept hunks on a correct blob (measured), so the gate below would refuse it.
const DIFF_FLAGS = ["--diff-algorithm=myers", "--no-color", "--no-ext-diff", "--no-textconv", "--inter-hunk-context=0"];

// bytes:true decodes stdout as latin1, which maps every byte to one char and back, so file
// content survives the round trip whatever its encoding. Input strings are written the same way.
// Every git child carries a timeout and is killed past it, because `hash-object -w --stdin`
// has sat idle at 0% CPU three times (no index.lock, the same command shape fine seconds
// earlier) and hung the whole call to the tool's cap. The limit is read per call so the
// self-test can shorten it. A timed-out call fails loud naming the verb.
// The verbs that can take index.lock get SIGTERM, on which git removes its lock; SIGKILL leaves
// it behind and every later git write in the repo then fails "index.lock: File exists"
// (measured). `diff` is one: a worktree diff rewrites the index to refresh stat-dirty entries
// (measured). Every other verb here takes no lock and gets SIGKILL, which nothing can ignore.
const INDEX_LOCK_VERBS = new Set(["update-index", "reset", "add", "rm", "checkout", "commit", "diff"]);
// STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB scopes the override to one verb, so the self-test can stall one
// verb at a short limit while every other call keeps the default: a short limit on every call
// failed under load, when an ordinary call took longer than it and the refusal named that verb.
// It may also name the verb and its first argument ("diff -U0"): `diff --cached` runs before the stalled
// `diff -U0`, and a 1 s limit on it killed it first when git was slow, so the SIGTERM arm read no TERM.
const GIT_TIMEOUT_DEFAULT_MS = 60_000;
const gitTimeoutMs = (args) => {
  const only = process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB;
  if (only && only !== args[0] && only !== args.slice(0, 2).join(" ")) return GIT_TIMEOUT_DEFAULT_MS;
  return Math.max(1, Number(process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_MS) || GIT_TIMEOUT_DEFAULT_MS);
};
function git(cwd, args, { input, bytes = false } = {}) {
  const timeout = gitTimeoutMs(args);
  try {
    return execFileSync("git", args, {
      cwd,
      input: input === undefined ? undefined : Buffer.from(input, "latin1"),
      encoding: bytes ? "latin1" : "utf8",
      // GIT_DIFF_OPTS would override -U0 after git parses its arguments, so it is blanked.
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1", GIT_DIFF_OPTS: "" },
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      killSignal: INDEX_LOCK_VERBS.has(args[0]) ? "SIGTERM" : "SIGKILL",
    });
  } catch (e) {
    if (e && e.code === "ETIMEDOUT") {
      // Thrown as-is by every caller: a timeout at or after update-index may leave the blob staged.
      // It names no index.lock: a verb that can take one was sent SIGTERM, and git removes its
      // lock on SIGTERM before it exits, which is before execFileSync returns here.
      const err = new Error(
        `REFUSED: \`git ${args[0]}\` did not finish within ${timeout} ms and was killed (STAGE_OWN_HUNKS_GIT_TIMEOUT_MS overrides the limit). ` +
          `This is the known intermittent hang of this helper. ` +
          `Read \`git diff --cached --name-only\` before re-running: a timeout at update-index or after it (the run printed "staged blob") can leave this run's blob staged and unverified, built on the HEAD this run started from. Then re-run the same command once; if it hangs again, stage by hand.`,
      );
      err.gitTimeout = true;
      throw err;
    }
    throw e;
  }
}

const lstatExists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

const hunkHead = (h) => toText(h.header.replace(/^(@@ [^@]* @@).*$/, "$1"));

// Each changed line, shortened, so a reader can check whose it is; a removed line carrying one of
// your keys is marked, since a removed line has no other sign of its owner.
function hunkLines(h, keys, max = 4) {
  const cut = (l) => (l.length > 72 ? l.slice(0, 69) + "..." : l);
  const out = [];
  const minus = h.minus.slice(0, max).map((l) => `      - ${toText(cut(l))}${keys.some((k) => l.includes(k)) ? "   [has your key]" : ""}`);
  const plus = h.plus.slice(0, max).map((l) => `      + ${toText(cut(l))}`);
  out.push(...minus);
  const keyedRest = h.minus.slice(max).filter((l) => keys.some((k) => l.includes(k))).length;
  if (h.minus.length > max) out.push(`      - ... ${h.minus.length - max} more${keyedRest ? `, ${keyedRest} of them [has your key]` : ""}`);
  out.push(...plus);
  if (h.plus.length > max) out.push(`      + ... ${h.plus.length - max} more`);
  return out;
}

const toBytes = (s) => Buffer.from(s, "utf8").toString("latin1");
const toText = (s) => Buffer.from(s, "latin1").toString("utf8");

function count(haystack, needle) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function parseHunks(diffText) {
  const hunks = [];
  let cur = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = null;
      continue;
    }
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      cur = {
        header: line,
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        minus: [],
        plus: [],
        noNewline: false,
      };
      hunks.push(cur);
    } else if (cur) {
      if (line.startsWith("-")) cur.minus.push(line.slice(1));
      else if (line.startsWith("+")) cur.plus.push(line.slice(1));
      else if (line.startsWith("\\")) cur.noNewline = true;
    }
  }
  return hunks;
}

// Pure: apply the chosen -U0 hunks to HEAD's text. Throws on anything it cannot place.
export function applyHunks(headText, hunks) {
  const trailingNewline = headText.endsWith("\n");
  const lines = headText.split("\n");
  if (trailingNewline) lines.pop();
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const h of ordered) {
    if (h.oldCount === 0) {
      // Pure insertion: -U0 numbers it AFTER old line oldStart.
      lines.splice(h.oldStart, 0, ...h.plus);
    } else {
      const at = h.oldStart - 1;
      const current = lines.slice(at, at + h.oldCount);
      if (current.join("\n") !== h.minus.join("\n")) {
        throw new Error(`hunk ${h.header} does not match HEAD at line ${h.oldStart}`);
      }
      lines.splice(at, h.oldCount, ...h.plus);
    }
  }
  if (lines.length === 0) return "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

export function selectHunks(hunks, keys, excludes, { keyInRemoved = false } = {}) {
  const keyed = (h) => (keyInRemoved ? [...h.plus, ...h.minus] : h.plus);
  const chosen = hunks.filter((h) => keys.some((k) => keyed(h).some((l) => l.includes(k))));
  const problems = [];
  for (const k of keys) {
    if (!chosen.some((h) => keyed(h).some((l) => l.includes(k)))) {
      problems.push(`--key matched no hunk: ${JSON.stringify(toText(k))}${keyInRemoved ? "" : " (only added lines are searched; --key-in-removed adds removed ones)"}`);
    }
  }
  for (const h of chosen) {
    h.unkeyedAdded = h.plus.filter((l) => !keys.some((k) => l.includes(k))).length;
    for (const x of excludes) {
      if ([...h.minus, ...h.plus].some((l) => l.includes(x))) {
        problems.push(`kept hunk ${toText(h.header)} also contains --exclude ${JSON.stringify(toText(x))} (another edit sits next to yours; build this blob by hand)`);
      }
    }
    if (h.noNewline) problems.push(`kept hunk ${toText(h.header)} touches a missing final newline; stage by hand`);
  }
  return { chosen, problems };
}

// `apply` is a seam for the self-test: it lets one arm hand the line-count gate a wrong blob.
function run(cwd, argv, log = console.log, { apply = applyHunks } = {}) {
  let path = null;
  const keys = [];
  const excludes = [];
  let dryRun = false;
  let strict = false;
  let keyInRemoved = false;
  let allowNumstat = null; // [plus, minus] the operator read and accepts, or null
  let expect = null; // [[plus, minus], ...]: one pair compares totals, several compare per hunk
  const pair = (flag, v) => {
    const m = /^\+(\d+)\/-(\d+)$/.exec(v ?? "");
    if (!m) throw new Error(`${flag} takes +ADDED/-REMOVED, e.g. ${flag}=+2/-1`);
    return [Number(m[1]), Number(m[2])];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--key" || a === "--exclude") {
      const v = argv[++i];
      if (v === undefined || v === "") throw new Error(`${a} needs a non-empty value`);
      if (v.startsWith("--")) throw new Error(`${a} got ${JSON.stringify(v)}, which looks like an option; a value cannot start with --`);
      (a === "--key" ? keys : excludes).push(toBytes(v));
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--strict") strict = true;
    else if (a === "--key-in-removed") keyInRemoved = true;
    else if (a === "--allow-numstat-mismatch" || a.startsWith("--allow-numstat-mismatch=")) allowNumstat = pair("--allow-numstat-mismatch", a.includes("=") ? a.slice(a.indexOf("=") + 1) : undefined);
    else if (a === "--expect" || a.startsWith("--expect=")) {
      if (expect) throw new Error("--expect given twice; put every pair in one --expect, comma-separated");
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      expect = String(v ?? "").split(",").map((one) => pair("--expect", one));
    }
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}\n${USAGE}`);
    else if (path === null) path = a;
    else throw new Error(`one path only\n${USAGE}`);
  }
  if (!path || keys.length === 0) throw new Error(USAGE);
  if (isAbsolute(path)) throw new Error("give the path relative to where you are, not absolute");

  // Resolve against the repository root so every git call below agrees on one path.
  const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const prefix = git(cwd, ["rev-parse", "--show-prefix"]).trim();
  const rel = posix.normalize(prefix + path);
  if (rel === ".." || rel.startsWith("../") || rel === "." || rel.endsWith("/")) {
    throw new Error(`${path} does not name a file inside this repository`);
  }

  const h0 = git(top, ["rev-parse", "HEAD"]).trim();
  const tree = git(top, ["ls-tree", h0, "--", rel]).trim();
  if (!tree) throw new Error(`${rel} is not in HEAD; for a new file use git add`);
  const [mode, type] = tree.split(/\s+/);
  if (type !== "blob") throw new Error(`${rel} is a ${type} in HEAD, not a file`);
  if (mode === "120000") throw new Error(`${rel} is a symlink in HEAD; stage it with git add`);
  const abs = join(top, rel);
  // A parent directory replaced by a symlink makes the file read as deleted or empty.
  const parts = rel.split("/");
  for (let n = 1; n < parts.length; n++) {
    const dirPath = join(top, ...parts.slice(0, n));
    if (lstatExists(dirPath) && lstatSync(dirPath).isSymbolicLink()) {
      throw new Error(`${parts.slice(0, n).join("/")} is a symlink in the worktree, so ${rel} cannot be staged from it; stage by hand`);
    }
  }
  // A DANGLING symlink would otherwise read as a deletion. A symlink to an existing file passes
  // isFile below and is refused by the two-file guard (a type change diffs as two files).
  if (!existsSync(abs) && lstatExists(abs) && lstatSync(abs).isSymbolicLink()) {
    throw new Error(`${rel} is a symlink in the worktree; stage it by hand`);
  }
  if (!existsSync(abs)) throw new Error(`${rel} is deleted in the worktree; stage a deletion with git rm`);
  if (!statSync(abs).isFile()) throw new Error(`${rel} is not a regular file in the worktree; stage it by hand`);
  const execInTree = (statSync(abs).mode & 0o111) !== 0;
  if (execInTree !== (mode === "100755")) {
    log(`note: the worktree's execute bit differs from HEAD's (${mode}); that mode change is NOT staged`);
  }
  if (git(top, ["diff", "--cached", "--name-only", "--", rel]).trim()) {
    throw new Error(`${rel} already has something staged; look at it (git diff --cached -- ${rel}) before staging over it`);
  }

  const headText = git(top, ["show", `${h0}:${rel}`], { bytes: true });
  const diff = git(top, ["diff", "-U0", ...DIFF_FLAGS, h0, "--", rel], { bytes: true });
  const fileHeaders = diff.split("\n").filter((l) => l.startsWith("diff --git ")).length;
  if (fileHeaders > 1) throw new Error(`REFUSED, nothing staged: the diff for ${rel} names ${fileHeaders} files`);
  if (/^Binary files /m.test(diff)) throw new Error(`REFUSED, nothing staged: ${rel} is binary`);
  // The checks above see the worktree before this diff runs; a deletion in between reaches it.
  if (/^deleted file mode /m.test(diff)) throw new Error(`REFUSED, nothing staged: ${rel} was deleted while this ran`);
  const hunks = parseHunks(diff);
  const { chosen, problems } = selectHunks(hunks, keys, excludes, { keyInRemoved });
  if (problems.length) throw new Error(`REFUSED, nothing staged:\n  - ${problems.join("\n  - ")}`);

  const blob = apply(headText, chosen);
  for (const x of excludes) {
    if (count(blob, x) !== count(headText, x)) {
      throw new Error(`REFUSED, nothing staged: the result changes how often --exclude ${JSON.stringify(toText(x))} appears`);
    }
  }

  let plus = 0;
  let minus = 0;
  let unkeyed = 0;
  log(`${rel}: keeping ${chosen.length} of ${hunks.length} hunk(s); leaving ${hunks.length - chosen.length} in the worktree only (HEAD ${h0.slice(0, 12)})`);
  for (const h of chosen) {
    plus += h.plus.length;
    minus += h.minus.length;
    unkeyed += h.unkeyedAdded;
    log(`  ${hunkHead(h)}  (+${h.plus.length} -${h.minus.length}; ${h.unkeyedAdded} of ${h.plus.length} added line(s) carry no --key)`);
    for (const l of hunkLines(h, keys)) log(l);
  }
  for (const h of hunks) {
    if (chosen.includes(h)) continue;
    log(`  left out: ${hunkHead(h)}  (+${h.plus.length} -${h.minus.length})`);
    for (const l of hunkLines(h, keys)) log(l);
  }
  if (strict && unkeyed > 0) {
    throw new Error(`REFUSED, nothing staged (--strict): ${unkeyed} kept added line(s) carry none of your keys`);
  }
  // A removed line carries no owner, so --strict also refuses a kept hunk that removes more lines
  // than it adds, unless --key-in-removed finds one of your keys on EVERY removed line in it.
  // Counting keyed removed lines against the surplus alone is not enough: your own rewritten
  // line is keyed on both sides, so it would cover a peer's deletion in the same hunk.
  for (const h of chosen) {
    const surplus = h.minus.length - h.plus.length;
    if (!strict || surplus <= 0) continue;
    const unkeyedRemoved = h.minus.filter((l) => !(keyInRemoved && keys.some((k) => l.includes(k)))).length;
    if (unkeyedRemoved > 0) {
      throw new Error(`REFUSED, nothing staged (--strict): kept hunk ${toText(h.header)} removes ${surplus} more line(s) than it adds, and ${unkeyedRemoved} of its ${h.minus.length} removed line(s) carry none of your keys (removed lines carry no owner). Check whose they are, then re-run WITHOUT --strict and with --expect +N/-M, or key the removed lines and pass --key-in-removed`);
    }
  }
  if (expect && expect.length === 1 && (expect[0][0] !== plus || expect[0][1] !== minus)) {
    throw new Error(`REFUSED, nothing staged: the kept hunks are +${plus} -${minus}, and you declared --expect +${expect[0][0]}/-${expect[0][1]}. Someone else's lines are in a kept hunk, or one of yours is in a hunk you did not keep`);
  }
  if (expect && expect.length !== 1) {
    const fmt = (ps) => ps.map(([p, m]) => `+${p}/-${m}`).join(","); // file order: a multiset lets git swap two hunks' shapes
    const kept = fmt(chosen.map((h) => [h.plus.length, h.minus.length]));
    if (kept !== fmt(expect)) {
      throw new Error(`REFUSED, nothing staged: the kept hunks are ${kept}, and you declared --expect ${fmt(expect)} per hunk. Someone else's lines share a hunk with yours, or git aligned a repeated line across them`);
    }
  }
  // The gate runs before --dry-run returns, so a dry run refuses whatever the real run refuses.
  const sha = git(top, ["hash-object", "-w", "--stdin"], { input: blob }).trim();
  const ns = git(top, ["diff", "--numstat", ...DIFF_FLAGS, `${h0}:${rel}`, sha]).trim();
  const [nsPlus, nsMinus] = ns ? ns.split("\t") : ["0", "0"];
  const nsAgrees = nsPlus === String(plus) && nsMinus === String(minus);
  const nsOverridden = !nsAgrees && allowNumstat && String(allowNumstat[0]) === nsPlus && String(allowNumstat[1]) === nsMinus;
  if (!nsAgrees && !nsOverridden) {
    throw new Error(`REFUSED, nothing staged: the blob differs from HEAD by +${nsPlus} -${nsMinus}, but the kept hunks are +${plus} -${minus}. Read \`git diff ${h0.slice(0, 12)}:${rel} ${sha.slice(0, 12)}\`; if every line there is yours, re-run with --allow-numstat-mismatch=+${nsPlus}/-${nsMinus}`);
  }
  if (nsOverridden) log(`OVERRIDE: blob vs HEAD +${nsPlus} -${nsMinus}, kept hunks +${plus} -${minus} (--allow-numstat-mismatch)`);
  if (dryRun) {
    log(`dry run: would stage +${plus} -${minus}; nothing staged`);
    return { blob, plus, minus };
  }

  // Last checks, adjacent to the write: HEAD first, since a landed commit would otherwise read as
  // someone else's stage. A peer write inside the one remaining spawn is caught by the read-back.
  if (git(top, ["rev-parse", "HEAD"]).trim() !== h0) {
    throw new Error("REFUSED, nothing staged: HEAD moved while this ran (a commit landed); re-run");
  }
  if (git(top, ["diff", "--cached", "--name-only", "--", rel]).trim()) {
    throw new Error(`REFUSED, nothing staged: ${rel} was staged by someone else, or a commit landed between the last two checks, while this ran; look at it first`);
  }
  try {
    git(top, ["update-index", "--cacheinfo", `${mode},${sha},${rel}`]);
  } catch (e) {
    if (e.gitTimeout) throw e;
    throw new Error(`REFUSED, nothing staged: git refused the write (${String(e.stderr || e.message).trim().split("\n")[0]}); another git process holds the index or changed it under this run; look at it and re-run`);
  }
  log(`staged blob ${sha.slice(0, 12)} (mode ${mode}); blob vs HEAD: +${nsPlus} -${nsMinus}${nsAgrees ? ", as the kept hunks predict" : ""}`);
  // HEAD first, then the read-back LAST, so the only in-run window left is a HEAD move after it.
  if (git(top, ["rev-parse", "HEAD"]).trim() !== h0) {
    const now = git(top, ["ls-files", "--stage", "--", rel]).trim().split(/\s+/)[1];
    if (now !== sha) {
      throw new Error(`REFUSED: HEAD moved after the stage, and ${rel} was restaged by someone else (index now holds ${String(now).slice(0, 12)}); theirs is left alone. Re-run`);
    }
    git(top, ["reset", "-q", "--", rel]);
    throw new Error("REFUSED and unstaged: HEAD moved after the stage; the blob was built on the old HEAD. Re-run");
  }
  const after = git(top, ["ls-files", "--stage", "--", rel]).trim().split(/\s+/)[1];
  if (after !== sha) {
    throw new Error(`REFUSED: ${rel} was restaged by someone else right after this wrote it (index now holds ${String(after).slice(0, 12)}); your blob is not staged, theirs is left alone`);
  }
  log(`Commit with scripts/safe-commit.sh --staged, while HEAD is still ${h0.slice(0, 12)}.`);
  return { blob, sha, plus, minus };
}

function selfTest() {
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_PARAMETERS", "GIT_DIFF_OPTS", "STAGE_OWN_HUNKS_GIT_TIMEOUT_MS", "STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB"]) delete process.env[k];
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
  });
  const results = [];
  // A run that throws where it should succeed fails the NEXT check, so a broken step is
  // reported by name instead of crashing the whole self-test.
  let lastErr = "";
  const check = (name, ok) => {
    results.push([lastErr ? `${name} (step failed: ${lastErr.split("\n")[0]})` : name, Boolean(ok) && lastErr === ""]);
    lastErr = "";
  };
  const dir = mkdtempSync(join(tmpdir(), "stage-own-hunks-"));
  const quiet = () => {};
  const tryRun = (cwd, args, log = quiet, opts = {}) => {
    try {
      run(cwd, args, log, opts);
      return "";
    } catch (e) {
      return e.message;
    }
  };
  try {
    const g = (...a) => git(dir, a);
    const step = (cwd, args, log = quiet) => {
      lastErr = tryRun(cwd, args, log);
    };
    const stagedNames = () => g("diff", "--cached", "--name-only").trim();
    g("init", "-q");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    // Hostile diff config for every arm: the tool's own flags must keep each of these out.
    g("config", "diff.interHunkContext", "3");
    g("config", "diff.algorithm", "histogram");
    g("config", "diff.upper.textconv", "tr a-z A-Z <");
    writeFileSync(join(dir, ".gitattributes"), "*.md diff=upper\n*.txt diff=upper\n");
    const base = ["# Title", "", "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", ""].join("\n");
    writeFileSync(join(dir, "f.md"), base);
    writeFileSync(join(dir, "x.sh"), "#!/bin/sh\necho one\necho two\necho three\necho four\necho five\n");
    execFileSync("chmod", ["+x", join(dir, "x.sh")]);
    g("add", "f.md", "x.sh", ".gitattributes");
    g("commit", "-q", "-m", "base");

    // Mine: change beta, append at end. Peer: change zeta (far from mine).
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE").replace("zeta", "zeta PEER") + "tail MINE\n");
    step(dir, ["f.md", "--key", "MINE", "--exclude", "PEER"], quiet);
    const stagedText = g("show", ":f.md");
    check("keeps my changed line", stagedText.includes("beta MINE"));
    check("keeps my appended line at the end", stagedText.endsWith("theta\ntail MINE\n"));
    check("leaves the peer line out of the stage", !stagedText.includes("PEER"));
    check("leaves the worktree untouched", g("diff", "--name-only", "--", "f.md").trim() === "f.md");
    check("refuses when the path is already staged", tryRun(dir, ["f.md", "--key", "MINE"]).includes("already has something staged"));
    g("reset", "-q");

    // Adjacent peer line: -U0 merges it into my hunk.
    writeFileSync(join(dir, "f.md"), base.replace("gamma", "gamma MINE").replace("delta", "delta PEER"));
    check("refuses an adjacent peer line via --exclude", tryRun(dir, ["f.md", "--key", "MINE", "--exclude", "PEER"]).includes("also contains --exclude"));
    check("stages nothing on refusal", stagedNames() === "");
    const lines = [];
    step(dir, ["f.md", "--key", "MINE", "--dry-run"], (l) => lines.push(l));
    check("reports the unkeyed added line in a kept hunk", lines.some((l) => l.includes("1 of 2 added line(s) carry no --key")));
    check("--strict refuses an unkeyed added line", tryRun(dir, ["f.md", "--key", "MINE", "--strict"]).includes("--strict"));
    check("stages nothing on a --strict refusal", stagedNames() === "");
    g("reset", "-q");

    check("refuses a key that matches no hunk", tryRun(dir, ["f.md", "--key", "MINE", "--key", "NOT-THERE"]).includes("matched no hunk"));
    g("reset", "-q");

    // Non-ASCII key and exclude: both must be mapped to the file's bytes.
    writeFileSync(join(dir, "f.md"), base.replace("gamma", "gamma \u2014 mine\u2019s").replace("delta", "delta \u2014 peer\u2019s"));
    check("refuses an adjacent peer line via a non-ASCII --exclude", tryRun(dir, ["f.md", "--key", "\u2014 mine\u2019s", "--exclude", "\u2014 peer\u2019s"]).includes("also contains --exclude"));
    check("stages nothing on a non-ASCII --exclude refusal", stagedNames() === "");
    g("reset", "-q");

    // The line-count gate, handed a wrong blob through the apply seam.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const extraLine = (h, c) => applyHunks(h, c) + "extra\n";
    check("refuses a blob the kept hunks do not predict", tryRun(dir, ["f.md", "--key", "MINE"], quiet, { apply: extraLine }).includes("the blob differs from HEAD"));
    check("dry run refuses it too", tryRun(dir, ["f.md", "--key", "MINE", "--dry-run"], quiet, { apply: extraLine }).includes("the blob differs from HEAD"));
    check("stages nothing on a line-count refusal", stagedNames() === "");
    g("reset", "-q");

    // Pure insertion in the middle lands at the right place.
    writeFileSync(join(dir, "f.md"), base.replace("delta\n", "delta\ninserted MINE\n").replace("theta", "theta PEER"));
    step(dir, ["f.md", "--key", "inserted MINE", "--exclude", "PEER"], quiet);
    check("places a middle insertion after its anchor line", g("show", ":f.md").includes("delta\ninserted MINE\nepsilon"));
    g("reset", "-q");

    // Executable bit survives.
    writeFileSync(join(dir, "x.sh"), "#!/bin/sh\necho one MINE\necho two\necho three\necho four\necho five PEER\n");
    step(dir, ["x.sh", "--key", "MINE", "--exclude", "PEER"], quiet);
    check("keeps the executable mode", g("ls-files", "--stage", "--", "x.sh").startsWith("100755"));
    g("reset", "-q");
    g("checkout", "-q", "--", "x.sh");

    // Dry run writes nothing.
    step(dir, ["f.md", "--key", "inserted MINE", "--dry-run"], quiet);
    check("dry run stages nothing", stagedNames() === "");
    execFileSync("chmod", ["+x", join(dir, "f.md")]);
    const notes = [];
    step(dir, ["f.md", "--key", "inserted MINE", "--dry-run"], (l) => notes.push(l));
    check("notes an execute-bit change it does not stage", notes.some((l) => l.includes("execute bit differs")));
    check("prints each left-out hunk", notes.some((l) => l.startsWith("  left out: ") && l.endsWith("(+1 -1)")));
    execFileSync("chmod", ["-x", join(dir, "f.md")]);
    check("refuses a path outside the repository", tryRun(dir, ["../x.md", "--key", "MINE"]).includes("inside this repository"));
    check("refuses an absolute path", tryRun(dir, [join(dir, "f.md"), "--key", "MINE"]).includes("not absolute"));

    check("refuses a path not in HEAD", tryRun(dir, ["new.md", "--key", "MINE"]).includes("not in HEAD"));

    // A peer stages the same path between the staged check and the write.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const peerStage = (line) => {
      if (line.includes("keeping")) g("update-index", "--cacheinfo", "100644," + git(dir, ["hash-object", "-w", "--stdin"], { input: "peer\n" }).trim() + ",f.md");
    };
    check("refuses when the path gets staged mid-run", tryRun(dir, ["f.md", "--key", "MINE"], peerStage).includes("staged by someone else"));
    g("reset", "-q");

    // HEAD moves before the stage: the log callback runs in that window.
    const peerCommit = (marker) => (line) => {
      if (line.includes(marker)) {
        const t = g("rev-parse", "HEAD^{tree}").trim();
        const c = g("commit-tree", t, "-p", "HEAD", "-m", "peer").trim();
        g("update-ref", "HEAD", c);
      }
    };
    check("refuses when HEAD moves before the stage", tryRun(dir, ["f.md", "--key", "MINE"], peerCommit("keeping")).includes("HEAD moved while this ran"));
    check("stages nothing when HEAD moves before the stage", stagedNames() === "");

    // A commit that CHANGES the file lands through another index: the index now differs from the
    // new HEAD, so HEAD must be checked before the stage or the refusal blames a stage.
    const landedVia = (line) => {
      if (!line.includes("keeping")) return;
      const b = git(dir, ["hash-object", "-w", "--stdin"], { input: "landed\n" }).trim();
      const entries = g("ls-tree", "HEAD").split("\n").filter(Boolean).map((l) => (l.endsWith("\tf.md") ? `100644 blob ${b}\tf.md` : l));
      const t = git(dir, ["mktree"], { input: entries.join("\n") + "\n" }).trim();
      g("update-ref", "HEAD", g("commit-tree", t, "-p", "HEAD", "-m", "landed").trim());
    };
    const beforeLanded = g("rev-parse", "HEAD").trim();
    check("blames HEAD, not a stage, when a commit to the file lands mid-run", tryRun(dir, ["f.md", "--key", "MINE"], landedVia).includes("HEAD moved while this ran"));
    g("update-ref", "HEAD", beforeLanded);

    // HEAD moves after the stage: it must unstage.
    check("refuses when HEAD moves after the stage", tryRun(dir, ["f.md", "--key", "MINE"], peerCommit("staged blob")).includes("REFUSED and unstaged"));
    check("unstages when HEAD moves after the stage", stagedNames() === "");
    g("reset", "-q");

    // Occurrence count: the only exclude it alone can see spans a line break.
    writeFileSync(join(dir, "f.md"), base.replace("delta\n", "delta\ninserted MINE\n"));
    check("refuses a result that changes an --exclude's count", tryRun(dir, ["f.md", "--key", "MINE", "--exclude", "delta\nepsilon"]).includes("changes how often"));
    check("stages nothing on a count refusal", stagedNames() === "");
    g("reset", "-q");

    // No final newline: a kept hunk at an EOF whose newline state changes.
    writeFileSync(join(dir, "n.txt"), "a\nb");
    g("add", "n.txt");
    g("commit", "-q", "-m", "n");
    writeFileSync(join(dir, "n.txt"), "a\nb MINE\n");
    check("refuses a hunk with a no-newline marker", tryRun(dir, ["n.txt", "--key", "MINE"]).includes("missing final newline"));
    check("stages nothing on a no-newline refusal", stagedNames() === "");
    g("reset", "-q");
    g("checkout", "-q", "--", "n.txt");
    writeFileSync(join(dir, "n.txt"), "a MINE\nb");
    step(dir, ["n.txt", "--key", "MINE"], quiet);
    check("keeps a missing final newline missing", g("show", ":n.txt") === "a MINE\nb");
    g("reset", "-q");
    g("checkout", "-q", "--", "n.txt");

    // A regular file replaced by a symlink diffs as TWO files under one path.
    writeFileSync(join(dir, "t.txt"), "one MINE\ntwo\n");
    g("add", "t.txt");
    g("commit", "-q", "-m", "t");
    unlinkSync(join(dir, "t.txt"));
    symlinkSync("f.md", join(dir, "t.txt"));
    check("refuses a type change, which diffs as two files", tryRun(dir, ["t.txt", "--key", "MINE", "--key-in-removed"]).includes("names 2 files"));
    check("stages nothing on a type-change refusal", stagedNames() === "");
    unlinkSync(join(dir, "t.txt"));
    g("checkout", "-q", "--", "t.txt");

    // A histogram-shaped edit: with diff.algorithm=histogram the blob-vs-HEAD count of a correct
    // blob is +5 -3 against kept hunks of +4 -2 unless the tool pins its algorithm.
    writeFileSync(join(dir, "h.txt"), "a\nc\na\nc\na\n");
    g("add", "h.txt");
    g("commit", "-q", "-m", "h");
    writeFileSync(join(dir, "h.txt"), "x\ncx\ny\nc\ncy\nc\n");
    step(dir, ["h.txt", "--key", "y"], quiet);
    check("stages a correct blob whatever the user's diff.algorithm", g("show", ":h.txt") === "x\ncx\ny\nc\ncy\nc\na\n");
    g("reset", "-q");
    g("checkout", "-q", "--", "h.txt");

    // Descending order: an earlier hunk that grows the file must not shift a later insertion.
    writeFileSync(join(dir, "f.md"), base.replace("beta\n", "beta MINE\nbeta2 MINE\n").replace("delta\n", "delta\nins MINE\n"));
    tryRun(dir, ["f.md", "--key", "MINE"]);
    check("applies multi-hunk edits bottom-up", g("show", ":f.md") === base.replace("beta\n", "beta MINE\nbeta2 MINE\n").replace("delta\n", "delta\nins MINE\n"));
    g("reset", "-q");

    // A non-UTF-8 byte on a line nobody touched survives byte for byte.
    const latin = Buffer.from("caf\xe9 latin1\nsecond\nthird\n", "latin1");
    writeFileSync(join(dir, "l.txt"), latin);
    g("add", "l.txt");
    g("commit", "-q", "-m", "l");
    writeFileSync(join(dir, "l.txt"), Buffer.from("caf\xe9 latin1\nsecond MINE\nthird\n", "latin1"));
    step(dir, ["l.txt", "--key", "MINE"], quiet);
    check("stages a non-UTF-8 file byte for byte", git(dir, ["show", ":l.txt"], { bytes: true }) === "caf\xe9 latin1\nsecond MINE\nthird\n");
    g("reset", "-q");

    // A glob-shaped path does not pull in a sibling it would match as a pattern.
    mkdirSync(join(dir, "dir name"));
    writeFileSync(join(dir, "dir name", "file [1].md"), "one\ntwo\n");
    writeFileSync(join(dir, "dir name", "file 1.md"), "uno\ndos\n");
    g("add", "dir name");
    g("commit", "-q", "-m", "globs");
    writeFileSync(join(dir, "dir name", "file [1].md"), "one MINE\ntwo\n");
    writeFileSync(join(dir, "dir name", "file 1.md"), "uno MINE\ndos\n");
    step(dir, ["dir name/file [1].md", "--key", "MINE"], quiet);
    check("stages only the named file, not a glob sibling", g("show", ":dir name/file [1].md") === "one MINE\ntwo\n");
    check("leaves the glob sibling unstaged", stagedNames() === "dir name/file [1].md");
    g("reset", "-q");
    check("refuses a directory path", tryRun(dir, ["dir name", "--key", "MINE"]).includes("not a file"));

    // From a subdirectory, the path is resolved there, not at the root.
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "README.md"), "root\n");
    writeFileSync(join(dir, "sub", "README.md"), "sub\n");
    g("add", "README.md", "sub/README.md");
    g("commit", "-q", "-m", "readmes");
    writeFileSync(join(dir, "sub", "README.md"), "sub\nsub MINE\n");
    step(join(dir, "sub"), ["README.md", "--key", "MINE"], quiet);
    check("from a subdirectory, stages that directory's file", stagedNames() === "sub/README.md" && g("show", ":sub/README.md") === "sub\nsub MINE\n");
    g("reset", "-q");
    step(dir, ["./sub/README.md", "--key", "MINE"], quiet);
    check("accepts a ./-prefixed path", stagedNames() === "sub/README.md");
    g("reset", "-q");

    // A key inside a line the PEER removed does not select the peer's deletion by default.
    writeFileSync(join(dir, "k.txt"), "keep\nold note about MINE\nend\n");
    g("add", "k.txt");
    g("commit", "-q", "-m", "k");
    writeFileSync(join(dir, "k.txt"), "keep\nend\nadded MINE\n");
    step(dir, ["k.txt", "--key", "MINE"], quiet);
    check("a key in a removed line does not select that deletion by default", g("show", ":k.txt") === "keep\nold note about MINE\nend\nadded MINE\n");
    g("reset", "-q");

    // Deleting every line stages an empty blob, not a lone newline.
    writeFileSync(join(dir, "k.txt"), "");
    step(dir, ["k.txt", "--key", "MINE", "--key-in-removed"], quiet);
    check("deleting every line stages an empty file", g("show", ":k.txt") === "");
    g("reset", "-q");

    // A file deleted in the worktree is refused.
    unlinkSync(join(dir, "k.txt"));
    check("refuses a file deleted in the worktree", tryRun(dir, ["k.txt", "--key", "MINE"]).includes("git rm"));
    g("checkout", "-q", "--", "k.txt");

    // A peer's DELETED line next to mine merges into my hunk: +1 -2 for my +1 -1.
    writeFileSync(join(dir, "f.md"), base.replace("gamma\ndelta\n", "gamma MINE\n"));
    const surplusMsg = tryRun(dir, ["f.md", "--key", "MINE", "--strict"]);
    check("--strict refuses a kept hunk that removes more than it adds", surplusMsg.includes("removes 1 more line"));
    check("the surplus refusal routes to a run WITHOUT --strict", surplusMsg.includes("re-run WITHOUT --strict"));
    check("--expect refuses kept hunks that differ from the declared edit", tryRun(dir, ["f.md", "--key", "MINE", "--expect", "+1/-1"]).includes("you declared --expect +1/-1"));
    check("stages nothing on an --expect refusal", stagedNames() === "");
    check("--expect refuses a declared edit that differs only in added lines", tryRun(dir, ["f.md", "--key", "MINE", "--expect", "+2/-2"]).includes("you declared --expect +2/-2"));
    check("rejects an --expect value with a tail", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+1/-2=x"]).includes("takes +ADDED/-REMOVED"));
    check("rejects a flag that only starts with --expect", tryRun(dir, ["f.md", "--key", "MINE", "--expected", "+1/-2"]).includes("unknown option"));
    step(dir, ["f.md", "--key", "MINE", "--expect=+1/-2"], quiet);
    check("--expect passes when the declared edit matches", stagedNames() === "f.md");
    g("reset", "-q");
    check("rejects a malformed --expect", tryRun(dir, ["f.md", "--key", "MINE", "--expect", "1,1"]).includes("takes +ADDED/-REMOVED"));

    // Per-hunk --expect, derived the way a seat would: diff HEAD against a copy holding only my edit.
    const myPairs = (headBody, mineOnly) => {
      writeFileSync(join(dir, ".mine-a"), headBody);
      writeFileSync(join(dir, ".mine-b"), mineOnly);
      let d = "";
      try {
        d = git(dir, ["diff", "--no-index", "-U0", ...DIFF_FLAGS, ".mine-a", ".mine-b"]);
      } catch (e) {
        d = e.stdout; // diff --no-index exits 1 when the files differ
      }
      unlinkSync(join(dir, ".mine-a"));
      unlinkSync(join(dir, ".mine-b"));
      return parseHunks(d).map((h) => `+${h.plus.length}/-${h.minus.length}`).join(",");
    };
    // Repro A: git lines up repeated b/e lines across my hunk and a peer's.
    const aBase = "b\nb\nb\nb\nd\nd\nc\nb\ne\ne\na\n";
    writeFileSync(join(dir, "ra.txt"), aBase);
    g("add", "ra.txt");
    g("commit", "-q", "-m", "ra");
    writeFileSync(join(dir, "ra.txt"), "b\ne PEER3\ne PEER4\nb\na MINE1\nd MINE2\nd\nc\ne\na\n");
    const aPairs = myPairs(aBase, "b\nb\nb\nb\na MINE1\nd MINE2\nd\nc\ne\na\n");
    check("per-hunk --expect refuses repro A, where totals matched a wrong blob", aPairs.includes(",") && tryRun(dir, ["ra.txt", "--key", "MINE", `--expect=${aPairs}`]).includes("per hunk"));
    check("stages nothing on a per-hunk refusal", stagedNames() === "");
    g("checkout", "-q", "--", "ra.txt");
    // Repro B: base d b c c; I delete line 1 and append; a peer rewrites line 3 into two lines.
    const bBase = "d\nb\nc\nc\n";
    writeFileSync(join(dir, "rb.txt"), bBase);
    g("add", "rb.txt");
    g("commit", "-q", "-m", "rb");
    writeFileSync(join(dir, "rb.txt"), "b\nd PEER1\ne PEER2\nc\ne MINE3\n");
    const bPairs = myPairs(bBase, "b\nc\nc\ne MINE3\n");
    check("per-hunk --expect refuses repro B, a balanced +1 -1 swap", bPairs.includes(",") && tryRun(dir, ["rb.txt", "--key", "MINE", `--expect=${bPairs}`]).includes("per hunk"));
    g("checkout", "-q", "--", "rb.txt");
    // And it passes when the per-hunk counts are really mine.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE") + "tail MINE\n");
    step(dir, ["f.md", "--key", "MINE", "--expect=+1/-1,+1/-0"], quiet);
    check("per-hunk --expect stages when every kept hunk matches", stagedNames() === "f.md");
    g("reset", "-q");
    check("per-hunk --expect compares in FILE order: the same pairs out of order are refused", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+1/-0,+1/-1"]).includes("per hunk") && stagedNames() === "");
    g("reset", "-q");
    check("per-hunk --expect compares a list of any length", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+1/-1,+1/-0,+0/-0"]).includes("per hunk"));
    check("refuses an empty --expect",tryRun(dir, ["f.md", "--key", "MINE", "--expect="]).includes("takes +ADDED/-REMOVED"));
    check("refuses a second --expect", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+9/-9", "--expect=+2/-1"]).includes("given twice"));
    // Same hunk count, one side differing: the compare must read both sides of every pair.
    writeFileSync(join(dir, "f.md"), base.replace("beta\ngamma\n", "beta MINE\n") + "tail MINE\n");
    check("per-hunk --expect refuses a removed-side difference at equal hunk count", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+1/-1,+1/-0"]).includes("per hunk"));
    writeFileSync(join(dir, "f.md"), base.replace("beta\n", "beta MINE\nbeta2 PEER\n") + "tail MINE\n");
    check("per-hunk --expect refuses an added-side difference at equal hunk count", tryRun(dir, ["f.md", "--key", "MINE", "--expect=+1/-1,+1/-0"]).includes("per hunk"));
    // An --exclude phrase on a peer's REMOVED line inside a kept hunk.
    writeFileSync(join(dir, "f.md"), base.replace("gamma\ndelta\n", "gamma MINE\n"));
    check("refuses a kept hunk whose removed line holds an --exclude phrase", tryRun(dir, ["f.md", "--key", "MINE", "--exclude", "delta"]).includes("also contains --exclude"));
    g("checkout", "-q", "--", "f.md");

    // A --key or --exclude value that looks like an option is refused, not swallowed.
    check("refuses an option-shaped --exclude value", tryRun(dir, ["f.md", "--key", "MINE", "--exclude", "--strict"]).includes("looks like an option"));
    check("refuses an option-shaped --key value", tryRun(dir, ["f.md", "--key", "--strict"]).includes("looks like an option"));
    check("accepts a key that starts with one dash (a list item)", !tryRun(dir, ["f.md", "--key", "- item", "--dry-run"]).includes("looks like an option"));
    check("stages nothing for an option-shaped value", stagedNames() === "");
    g("reset", "-q");

    // Left-out lines are printed, and a removed line carrying my key is marked.
    writeFileSync(join(dir, "f.md"), base.replace("alpha\n", "").replace("zeta", "zeta MINE"));
    const shown = [];
    step(dir, ["f.md", "--key", "zeta MINE", "--dry-run"], (l) => shown.push(l));
    check("prints the lines of a left-out hunk", shown.some((l) => l.trim() === "- alpha"));
    check("prints the lines of a kept hunk", shown.some((l) => l.trim() === "+ zeta MINE"));
    check("prints a kept hunk's bare @@ range, not git's context line", shown.some((l) => l.startsWith("  @@ -8 +7 @@  (+1 -1;")));
    g("checkout", "-q", "--", "f.md");
    // A keyed removed line past the shown four is still flagged.
    writeFileSync(join(dir, "mk6.txt"), "h\nr1\nr2\nr3\nr4\nr5\nr6 MINE\nm\nz\n");
    g("add", "mk6.txt");
    g("commit", "-q", "-m", "mk6");
    writeFileSync(join(dir, "mk6.txt"), "h\nm\nz MINE\n");
    const cut6 = [];
    step(dir, ["mk6.txt", "--key", "MINE", "--dry-run"], (l) => cut6.push(l));
    check("flags a keyed removed line hidden past the shown four", cut6.some((l) => l.includes("... 2 more") && l.includes("[has your key]")));
    g("checkout", "-q", "--", "mk6.txt");
    // My deletion of a keyed line sits in its own hunk, which a plus-only key does not select.
    writeFileSync(join(dir, "mk.txt"), "x\ny old MINE\nz\nw\n");
    g("add", "mk.txt");
    g("commit", "-q", "-m", "mk");
    writeFileSync(join(dir, "mk.txt"), "x\nz\nw MINE\n");
    const marked = [];
    step(dir, ["mk.txt", "--key", "MINE", "--dry-run"], (l) => marked.push(l));
    check("marks a left-out removed line that carries a key", marked.some((l) => l.includes("y old MINE") && l.includes("[has your key]")));
    g("checkout", "-q", "--", "mk.txt");

    // A parent directory replaced by a symlink is refused, not staged as an empty file.
    mkdirSync(join(dir, "pd"));
    writeFileSync(join(dir, "pd", "inner.txt"), "one MINE\n");
    g("add", "pd/inner.txt");
    g("commit", "-q", "-m", "pd");
    rmSync(join(dir, "pd"), { recursive: true });
    mkdirSync(join(dir, "elsewhere"));
    writeFileSync(join(dir, "elsewhere", "inner.txt"), "");
    symlinkSync("elsewhere", join(dir, "pd"));
    check("refuses a path whose parent directory is now a symlink", tryRun(dir, ["pd/inner.txt", "--key", "MINE", "--key-in-removed"]).includes("is a symlink in the worktree"));
    check("stages nothing under a symlinked parent", stagedNames() === "");
    unlinkSync(join(dir, "pd"));
    // The same one level down: every parent is walked, not only the first.
    mkdirSync(join(dir, "pd", "q"), { recursive: true });
    writeFileSync(join(dir, "pd", "q", "inner.txt"), "one MINE\n");
    g("add", "pd/q/inner.txt");
    g("commit", "-q", "-m", "pdq");
    rmSync(join(dir, "pd", "q"), { recursive: true });
    symlinkSync("../elsewhere", join(dir, "pd", "q"));
    check("refuses a path whose nested parent directory is now a symlink", tryRun(dir, ["pd/q/inner.txt", "--key", "MINE", "--key-in-removed"]).includes("pd/q is a symlink in the worktree"));
    unlinkSync(join(dir, "pd", "q"));
    rmSync(join(dir, "elsewhere"), { recursive: true });
    g("checkout", "-q", "--", "pd/inner.txt", "pd/q/inner.txt");
    // A deletion landing between the worktree checks and the diff: a PATH shim deletes the file
    // just before `git diff -U0` runs, which is the window no static state reaches.
    writeFileSync(join(dir, "dd.txt"), "one MINE\ntwo\n");
    g("add", "dd.txt");
    g("commit", "-q", "-m", "dd");
    writeFileSync(join(dir, "dd.txt"), "one MINE\ntwo MINE\n");
    const shim = mkdtempSync(join(tmpdir(), "stage-own-hunks-shim-"));
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(join(shim, "git"), `#!/bin/sh\nfor a; do [ "$a" = -U0 ] && rm -f '${join(dir, "dd.txt")}'; done\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    const pathBefore = process.env.PATH;
    process.env.PATH = `${shim}:${pathBefore}`;
    const ddMsg = tryRun(dir, ["dd.txt", "--key", "MINE", "--key-in-removed"]);
    process.env.PATH = pathBefore;
    rmSync(shim, { recursive: true, force: true });
    check("refuses a file deleted between the worktree checks and the diff", ddMsg.includes("was deleted while this ran"));
    check("stages nothing for a mid-run deletion", stagedNames() === "");
    g("checkout", "-q", "--", "dd.txt");

    // Run `fn` with the shim dir first on PATH and a 1 s limit on `verb` alone (every other git call keeps the
    // default), restoring both however `fn` ends.
    const withGitStall = (shimDir, verb, fn) => {
      process.env.PATH = `${shimDir}:${pathBefore}`;
      process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_MS = "1000";
      process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB = verb;
      try {
        return fn();
      } finally {
        delete process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_MS;
        delete process.env.STAGE_OWN_HUNKS_GIT_TIMEOUT_VERB;
        process.env.PATH = pathBefore;
      }
    };
    // A git child that never exits: a PATH shim makes `hash-object` sleep past the timeout, so
    // the helper must fail loud naming the verb, near the limit, and stage nothing. The sleep
    // ignores SIGTERM, so only the SIGKILL a lock-free verb is sent ends it near the limit.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const stall = mkdtempSync(join(tmpdir(), "stage-own-hunks-stall-"));
    // the stalled call alone is timed, from a marker its shim writes as it starts: the run's other git calls,
    // slow under load, are no part of whether the timeout fired near its limit
    const stallMark = join(stall, "started");
    writeFileSync(join(stall, "git"), `#!/bin/sh\n[ "$1" = hash-object ] && { : > '${stallMark}'; trap '' TERM; exec sleep 30; }\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    const stallMsg = withGitStall(stall, "hash-object", () => tryRun(dir, ["f.md", "--key", "MINE"]));
    const stallMs = existsSync(stallMark) ? Date.now() - statSync(stallMark).mtimeMs : Infinity;
    rmSync(stall, { recursive: true, force: true });
    check("fails loud naming the verb when a git child never exits", stallMsg.includes("`git hash-object` did not finish within 1000 ms"));
    check("the timeout fires near its limit, not at the tool's cap", stallMs < 10_000);
    check("stages nothing when a git child timed out", stagedNames() === "");
    // A stall AT the write, and one AFTER it: neither may claim "nothing staged" or be re-worded.
    for (const [verb, staged] of [["update-index", ""], ["ls-files", "f.md"]]) {
      const st = mkdtempSync(join(tmpdir(), "stage-own-hunks-stall-"));
      writeFileSync(join(st, "git"), `#!/bin/sh\n[ "$1" = ${verb} ] && exec sleep 30\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
      const msg = withGitStall(st, verb, () => tryRun(dir, ["f.md", "--key", "MINE"]));
      rmSync(st, { recursive: true, force: true });
      check(`a stall in \`${verb}\` surfaces unwrapped and claims nothing about the stage`, msg.startsWith(`REFUSED: \`git ${verb}\` did not finish`) && !/nothing (was )?staged/i.test(msg));
      check(`the index after a stall in \`${verb}\` is what the message warns of`, stagedNames() === staged);
      g("reset", "-q");
    }
    g("checkout", "-q", "--", "f.md");

    // An index-writing verb that stalls holding index.lock gets SIGTERM, on which git removes the lock.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const termStall = mkdtempSync(join(tmpdir(), "stage-own-hunks-lock-"));
    execFileSync("mkfifo", [join(termStall, "fifo")]);
    const writer = spawn("sh", ["-c", `exec sleep 30 > '${join(termStall, "fifo")}'`], { stdio: "ignore" });
    writeFileSync(join(termStall, "git"), `#!/bin/sh\n[ "$1" = update-index ] && exec '${realGit}' update-index --index-info < '${join(termStall, "fifo")}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    const termMsg = withGitStall(termStall, "update-index", () => tryRun(dir, ["f.md", "--key", "MINE"]));
    writer.kill();
    rmSync(termStall, { recursive: true, force: true });
    check("names update-index when it times out holding the index lock", termMsg.includes("`git update-index` did not finish within 1000 ms"));
    check("a timed-out update-index leaves no index.lock behind", !existsSync(join(dir, ".git", "index.lock")));
    g("checkout", "-q", "--", "f.md");

    // `diff` can take index.lock too (a worktree diff refreshes the index), so a stalled one must
    // be sent SIGTERM as well: the shim's TERM trap leaves a marker that SIGKILL never would.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const diffStall = mkdtempSync(join(tmpdir(), "stage-own-hunks-diff-"));
    const termMark = join(diffStall, "got-term");
    writeFileSync(join(diffStall, "git"), `#!/bin/sh\n[ "$1" = diff ] && [ "$2" = -U0 ] && { trap ": > '${termMark}'; exit 143" TERM; sleep 5 </dev/null >/dev/null 2>&1 & wait; exit 0; }\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    const diffMsg = withGitStall(diffStall, "diff -U0", () => tryRun(dir, ["f.md", "--key", "MINE"]));
    const diffGotTerm = existsSync(termMark);
    rmSync(diffStall, { recursive: true, force: true });
    check("names diff when it times out", diffMsg.includes("`git diff` did not finish within 1000 ms"));
    check("a timed-out diff is sent SIGTERM, so a lock it holds is removed", diffGotTerm);
    g("checkout", "-q", "--", "f.md");

    // An ordinary in-place rewrite (+1 -1, its removed line unkeyed) has no surplus: --strict stages it.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    step(dir, ["f.md", "--key", "MINE", "--strict"], quiet);
    check("--strict stages an ordinary rewrite, whose one removed line carries no key", g("show", ":f.md") === base.replace("beta", "beta MINE"));
    g("reset", "-q");

    // --strict's surplus rule: only --key-in-removed may claim removed lines, and it must claim
    // every one of them. Here both removed lines carry the key, and the surplus is one.
    writeFileSync(join(dir, "r.txt"), "a\nx MINE\ny MINE\nb\n");
    g("add", "r.txt");
    g("commit", "-q", "-m", "r");
    writeFileSync(join(dir, "r.txt"), "a\nz MINE\nb\n");
    check("--strict ignores a key in a removed line without --key-in-removed", tryRun(dir, ["r.txt", "--key", "MINE", "--strict"]).includes("removes 1 more line"));
    step(dir, ["r.txt", "--key", "MINE", "--strict", "--key-in-removed"], quiet);
    check("--strict accepts a surplus when every removed line carries a key", stagedNames() === "r.txt");
    g("reset", "-q");
    g("checkout", "-q", "--", "r.txt");

    // My keyed line rewritten in place, a peer's line deleted beside it: +1 -2. My rewritten line is
    // keyed on BOTH sides, so it must not cover the peer's deletion.
    writeFileSync(join(dir, "w.txt"), "L1\nL2\nL3 MINE\nL4\nL5\nL6\n");
    g("add", "w.txt");
    g("commit", "-q", "-m", "w");
    writeFileSync(join(dir, "w.txt"), "L1\nL2\nL3 MINE v2\nL5\nL6\n");
    check("--strict --key-in-removed refuses a peer deletion beside my rewritten line", tryRun(dir, ["w.txt", "--key", "MINE", "--strict", "--key-in-removed"]).includes("1 of its 2 removed line(s) carry none"));
    check("stages nothing when a peer deletion sits beside my rewrite", stagedNames() === "");
    g("checkout", "-q", "--", "w.txt");

    // A dangling symlink is named as a symlink, not misread as a deletion.
    unlinkSync(join(dir, "w.txt"));
    symlinkSync("does-not-exist", join(dir, "w.txt"));
    check("names a dangling symlink rather than calling it a deletion", tryRun(dir, ["w.txt", "--key", "MINE"]).includes("symlink in the worktree"));
    unlinkSync(join(dir, "w.txt"));
    g("checkout", "-q", "--", "w.txt");

    // A binary file is refused by name, not as a key that matched nothing.
    writeFileSync(join(dir, "b.bin"), Buffer.from([0, 1, 2, 10]));
    g("add", "b.bin");
    g("commit", "-q", "-m", "b");
    writeFileSync(join(dir, "b.bin"), Buffer.concat([Buffer.from([0, 1, 2, 10]), Buffer.from("MINE\n")]));
    check("refuses a binary file", tryRun(dir, ["b.bin", "--key", "MINE"]).includes("is binary"));
    g("checkout", "-q", "--", "b.bin");

    // The override must name the exact pair the gate measured, and says so when used.
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE"));
    const extra = (h, c) => applyHunks(h, c) + "extra\n";
    for (const wrong of ["+9/-9", "+2/-9", "+9/-1"]) {
      check(`an override naming ${wrong} (measured: +2/-1) still refuses`, tryRun(dir, ["f.md", "--key", "MINE", `--allow-numstat-mismatch=${wrong}`], quiet, { apply: extra }).includes("the blob differs from HEAD"));
    }
    check("rejects a flag that only starts with --allow-numstat-mismatch", tryRun(dir, ["f.md", "--key", "MINE", "--allow-numstat-mismatchX=+2/-1"], quiet, { apply: extra }).includes("unknown option"));
    check("rejects an --allow-numstat-mismatch value with a tail", tryRun(dir, ["f.md", "--key", "MINE", "--allow-numstat-mismatch=+2/-1=x"], quiet, { apply: extra }).includes("takes +ADDED/-REMOVED"));
    const ov = [];
    lastErr = tryRun(dir, ["f.md", "--key", "MINE", "--allow-numstat-mismatch=+2/-1"], (l) => ov.push(l), { apply: extra });
    check("an override naming the measured pair stages and prints OVERRIDE", stagedNames() === "f.md" && ov.some((l) => l.startsWith("OVERRIDE:")));
    g("reset", "-q");

    // Someone restages the path right after this tool's write: refuse, leave theirs.
    const restage = (line) => {
      if (line.startsWith("staged blob")) g("update-index", "--cacheinfo", "100644," + git(dir, ["hash-object", "-w", "--stdin"], { input: "theirs\n" }).trim() + ",f.md");
    };
    check("refuses when the path is restaged right after the write", tryRun(dir, ["f.md", "--key", "MINE"], restage).includes("restaged by someone else"));
    check("leaves the other session's restage in place", g("show", ":f.md") === "theirs\n");
    g("reset", "-q");

    // A restage AND a HEAD move after the write: the HEAD branch's unstage must not wipe theirs.
    const restageAndCommit = (line) => {
      restage(line);
      peerCommit("staged blob")(line);
    };
    check("names both a restage and a HEAD move that land after the write", tryRun(dir, ["f.md", "--key", "MINE"], restageAndCommit).includes("HEAD moved after the stage, and f.md was restaged"));
    check("leaves the restage in place when HEAD also moved", g("show", ":f.md") === "theirs\n");
    g("reset", "-q");

    // The index is locked between the stage check and the write: git's refusal is named.
    const lockIndex = (line) => {
      if (line.includes("keeping")) writeFileSync(join(dir, ".git", "index.lock"), "");
    };
    const lockMsg = tryRun(dir, ["f.md", "--key", "MINE"], lockIndex);
    rmSync(join(dir, ".git", "index.lock"), { force: true });
    check("names a refused index write as REFUSED", lockMsg.startsWith("REFUSED, nothing staged: git refused the write"));
    check("stages nothing when the index write is refused", stagedNames() === "");

    // GIT_DIFF_OPTS from the caller must not widen -U0.
    process.env.GIT_DIFF_OPTS = "-u3";
    writeFileSync(join(dir, "f.md"), base.replace("beta", "beta MINE").replace("delta", "delta PEER"));
    step(dir, ["f.md", "--key", "MINE", "--exclude", "PEER"], quiet);
    delete process.env.GIT_DIFF_OPTS;
    check("ignores a caller's GIT_DIFF_OPTS", !g("show", ":f.md").includes("PEER") && g("show", ":f.md").includes("beta MINE"));
    g("reset", "-q");
    g("checkout", "-q", "--", "f.md");

    // A symlink in HEAD, and a file replaced by a directory, are refused up front.
    symlinkSync("f.md", join(dir, "s.lnk"));
    g("add", "s.lnk");
    g("commit", "-q", "-m", "s");
    check("refuses a symlink in HEAD", tryRun(dir, ["s.lnk", "--key", "MINE"]).includes("symlink in HEAD"));
    unlinkSync(join(dir, "k.txt"));
    mkdirSync(join(dir, "k.txt"));
    check("refuses a path that is now a directory", tryRun(dir, ["k.txt", "--key", "MINE", "--key-in-removed"]).includes("not a regular file"));
    check("stages nothing for a non-regular path", stagedNames() === "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`${results.length - failed}/${results.length} passed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--self-test") process.exit(selfTest());
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  try {
    run(process.cwd(), argv);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
