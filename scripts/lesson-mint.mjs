#!/usr/bin/env node
// lesson-mint.mjs — collision-free allocation of the next `L#` on a SHARED ledger.
//
// WHY (revisit trigger occ-4 — fired occ-4/5/6 on 2026-07-31 inside ninety minutes):
// `maxL` is a READ, not a reservation. Every seat that reads the counter inside one window
// gets the same answer and writes the same number. That is a PROTOCOL property, not N
// mistakes — each seat followed the documented procedure exactly. `check-lesson-numbers.mjs`
// turns the resulting corruption into a red at the push boundary; it does not lower the
// collision rate. This does.
//
// ── THE MECHANISM: WRITE FIRST, THEN DISCOVER WHAT YOU GOT ──
// The race is read-then-write. So we never read a counter and write based on it. A mint is a
// single O_APPEND write of one short line to `.claude/state/lesson-seq`; the allocation is the
// POSITION that line landed in. Two concurrent appends land on two different lines, so two
// seats cannot receive the same number — not "unlikely", impossible by construction.
//
// POSIX guarantees a single write() under PIPE_BUF (4096) to an O_APPEND fd is atomic: the
// offset advance and the data write cannot interleave. Every line we emit is far under that;
// `assertLineFitsAtomicWrite` enforces it rather than assuming it (a slug long enough to cross
// PIPE_BUF would silently reintroduce the interleaving this file exists to remove).
//
// ── WHY NOT THE ALTERNATIVES ──
// flock counter        — serialises the mint but still allocates by READING; a stale lock from
//                        a crashed seat blocks the fleet, and it does nothing for the second
//                        half below.
// PreToolUse hook      — fires when the number is already chosen. It can BLOCK a collision; it
//                        cannot ALLOCATE.
// namespaced draft-IDs — defers numbering to commit time, which moves the race rather than
//                        removing it, and breaks every citation written before the commit.
//
// ── THE SECOND HALF, which is why a claim file was the right pick ──
// A number collision is caught by the gate. A CONTENT collision is not: twice on 2026-07-31 two
// seats independently wrote the SAME LESSON minutes apart from the same incident, and the gate
// reports green because the numbers differ. Claiming early is the only moment a peer can see
// WHAT you are about to write — so the slug is mandatory, and `status` surfaces in-flight slugs
// for exactly this reason. It does not prevent duplicates; it makes them visible while they are
// still cheap to merge.
//
// Usage:
//   node scripts/lesson-mint.mjs init            # bootstrap; BASE derived, never typed
//   node scripts/lesson-mint.mjs mint --sid <sid8> --slug "<what you are writing>"
//   node scripts/lesson-mint.mjs status          # allocations + reconciliation vs MEMORY.md
//   node scripts/lesson-mint.mjs --self-test

import { openSync, writeSync, closeSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isMain as isMainModule } from "./lib/is-main.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// REPO is the MAIN checkout from any cwd — a linked worktree carries its own copy of this file,
// so `resolve(HERE, "..")` from one would allocate L# against a PRIVATE, empty ledger and mint
// a number a peer already holds (measured in a linked worktree, 2026-09-07; the same defect and the
// same fix as session-manifest.py's mail store). `--git-common-dir` is the one
// `.git` every worktree shares; its parent is the main checkout. Falls back to the file-location
// form when git is unavailable, so a bare copy outside any repo still runs.
/** Does a `--git-common-dir` answer belong to a CHECKOUT? Extracted so the predicate itself is
 *  mutation-covered: with it inline, reverting `basename` to `endsWith` survived the whole
 *  self-test (measured 2026-09-09 on my own four-mutation matrix — the other three arms died, this
 *  one did not, and a mutation that survives is the next finding waiting to happen). */
export function gitDirLooksLikeCheckout(common) {
  return basename(common) === ".git";
}

const { REPO, REPO_SOURCE, GIT_COMMON } = (() => {
  // NAMED OVERRIDE, first: the only route for a seat whose git is refusing (dubious-ownership under
  // `safe.directory`, git ≥2.35.2 exits 128; a corrupted `.git`; git off PATH) while standing in a
  // perfectly good checkout. Before it existed the gate below refused such a seat and its message
  // told them to go to a live checkout they were already in — measured on the real checkout with
  // git off PATH, where SEQ_DEFAULT was the CORRECT ledger and the tool refused anyway.
  // Their only remaining route was the `maxL + 1` fallback that this whole chain exists
  // to make unnecessary. The override is still subject to the containment check below, so it cannot
  // be junk.
  const override = process.env.LESSON_MINT_REPO;
  if (override) return { REPO: resolve(override), REPO_SOURCE: "override" };
  // ONE resolution, TWO facts — never two `git rev-parse` calls that could disagree.
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // ⛔ `basename(common) === ".git"`, NOT `endsWith(".git")` — the two differ exactly on the states
    // this gate exists to reject, and I evaluated the predicate rather than reasoning about it
    // (measured on this box):
    //   main checkout ................... common /repo/.git        endsWith ✓  basename ✓
    //   linked worktree ................. common /repo/.git        endsWith ✓  basename ✓
    //   bare repo named *.git ........... common /x/foo.git        endsWith ✓  basename ✗
    //   --separate-git-dir ending .git .. common /store/name.git   endsWith ✓  basename ✗
    // endsWith accepted the last two and left the containment check below to catch them, which it
    // only does when the wrong root happens to lack the anchors — a measured rig landed in a wrong
    // root whose parent carried both. Structure closes it; containment cannot.
    if (gitDirLooksLikeCheckout(common)) return { REPO: dirname(common), REPO_SOURCE: "git", GIT_COMMON: common };
    // git ANSWERED and the shape is wrong. A distinct state from "git failed": reporting this as a
    // git failure sends the next reader to debug a working git, which is the class of wrong
    // diagnosis this whole chain has been about. Caught on my own rig before it shipped.
    return { REPO: resolve(HERE, ".."), REPO_SOURCE: "rejected", GIT_COMMON: common };
  } catch { /* git unavailable, or not a repo at all — fall through, and RECORD it */ }
  return { REPO: resolve(HERE, ".."), REPO_SOURCE: "fallback", GIT_COMMON: null };
})();
/** True when REPO came from git or an explicit override rather than the file-relative GUESS. The
 *  guess is the original behaviour: inside a linked worktree it is that worktree's own private,
 *  usually empty ledger. Measured reachable 2026-09-09: in a PRUNED
 *  worktree `git rev-parse` exits `fatal: not a git repository`, the catch fires, and the fallback
 *  silently restores the defect. ⛔ IT MUST STAY A CONJUNCT of REPO_USABLE — relaxing to containment
 *  alone re-opens exactly that hole, because every linked worktree carries both anchors
 *  (measured on two). */
export const REPO_FROM_GIT = REPO_SOURCE !== "fallback";
/** Provenance is not correctness. `REPO_FROM_GIT` says the
 *  value CAME FROM git; it cannot say the value is RIGHT. Two states resolve cleanly and still land
 *  outside a checkout: a BARE repo named `*.git` (dirname is its parent, which is not a checkout)
 *  and a `--separate-git-dir` store whose path ends in `.git`. So key the WRITE gate on what the
 *  root CONTAINS — that closes both, plus any third nobody has enumerated.
 *  ⚠️ MEASURED, and it corrects the finding it came from: in a bare-repo rig the write does NOT
 *  silently proceed today. It dies in the drift-floor spawn with a raw `Cannot find module …
 *  /barerig/scripts/check-lesson-numbers.mjs` stack and allocates nothing — REPO-relative
 *  spawn is an accidental backstop. This assertion is therefore a DIAGNOSIS upgrade plus cover for
 *  the case where the wrong root happens to carry a `scripts/check-lesson-numbers.mjs`, not a rescue
 *  from a live silent-write defect. Anchors chosen for stability: the corpus the numbering is over,
 *  and the child the floor spawns. NOT this file's own path — but the reason I first gave for that
 *  was WRONG. I called it a CATEGORY difference; it is
 *  AGE. `REPO` is the main checkout, so both anchors are evaluated against whatever that checkout
 *  currently holds, and `scripts/check-lesson-numbers.mjs` sits under the identical hazard — it is
 *  merely older (2026-07-10 against this file's 2026-07-31). Live consequence, stated rather than
 *  hidden: a `git checkout <pre-2026-07-10 sha>` on the main checkout takes REPO_USABLE false for
 *  every worktree in the fleet at once. The escape from that state is LESSON_MINT_REPO, which is
 *  why the override and this anchor choice belong in the same commit. */
export const REPO_USABLE =
  REPO_FROM_GIT &&
  existsSync(resolve(REPO, ".claude/skills/meta")) &&
  existsSync(resolve(REPO, "scripts/check-lesson-numbers.mjs"));

export const SEQ_DEFAULT = resolve(REPO, ".claude/state/lesson-seq");
const MEMORY_DEFAULT = resolve(REPO, ".claude/skills/meta/MEMORY.md");

const PIPE_BUF = 4096;
const HEADER_RE = /^#\s*base=(\d+)\s*$/;

/** A mint line is TAB-separated and single-line by construction: sid/slug are sanitised so a
 *  newline in a slug cannot forge an extra allocation. */
export function formatLine({ sid, slug, ts, nonce }) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ").trim();
  return `${clean(sid)}\t${clean(ts)}\t${clean(nonce)}\t${clean(slug)}\n`;
}

/** POSIX atomicity holds only under PIPE_BUF. Enforce rather than assume — a long slug would
 *  silently reintroduce the interleaving this whole file exists to remove. */
export function assertLineFitsAtomicWrite(line) {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes >= PIPE_BUF) {
    throw new Error(
      `lesson-mint: line is ${bytes} bytes, at or over PIPE_BUF (${PIPE_BUF}) — the append would ` +
        `no longer be atomic and two concurrent mints could interleave. Shorten the slug.`,
    );
  }
  return bytes;
}

/** Walk the log in order, maintaining a MONOTONIC counter.
 *
 *  A `# base=N` line RAISES the counter to N; it can never lower it. That single rule is what
 *  makes concurrent header appends safe: two seats that both notice ledger drift may both append
 *  a header, in any interleaving with each other's allocation lines, and no allocation can ever
 *  be issued a number at or below one already issued. A duplicate or lower header is inert; a
 *  higher one just skips a range, and gaps are legal in the ledger.
 *
 *  Numbers are therefore stable once issued: a later re-base cannot renumber an earlier line,
 *  which is the property a purely positional scheme loses the moment the floor has to move. */
export function parseSeq(text) {
  const lines = text.split("\n");
  if (!lines.some((l) => HEADER_RE.test(l))) {
    throw new Error("lesson-mint: no `# base=N` header — run `init` first");
  }
  const allocations = [];
  let next = 0;
  for (const l of lines) {
    if (HEADER_RE.test(l)) {
      next = Math.max(next, Number(HEADER_RE.exec(l)[1])); // RAISE ONLY
      continue;
    }
    if (l.trim() === "" || l.startsWith("#")) continue;
    const [sid, ts, nonce, ...rest] = l.split("\t");
    allocations.push({ n: next, sid, ts, nonce, slug: rest.join("\t"), index: allocations.length });
    next++;
  }
  const base = Number(HEADER_RE.exec(lines.find((l) => HEADER_RE.test(l)))[1]);
  return { base, next, allocations };
}

/** The allocation itself. Returns the L# this call OWNS.
 *  Write first (atomic), then read back and find our own line by nonce — the POSITION is the
 *  allocation. Nothing is computed from a counter we read beforehand. */
export function allocate(seqPath, { sid, slug, nonce, ts, ledgerNextFree }) {
  const line = formatLine({ sid, slug, nonce, ts });
  assertLineFitsAtomicWrite(line);

  // DRIFT FLOOR. The sequence is not the only thing that consumes numbers: a seat using the
  // Step-2b fallback, a `git pull` landing another clone's lessons, or a hand-picked renumber all
  // advance the LEDGER without advancing this file. A frozen base then hands out a number that
  // already exists — measured, not hypothetical. So consult the ledger on every mint and RAISE
  // the floor when it has moved ahead. `parseSeq`'s raise-only rule makes a concurrent duplicate
  // header inert, so this append needs no coordination with anyone else's.
  const floor = typeof ledgerNextFree === "number" ? ledgerNextFree : nextFreeFromLedger();
  const fd = openSync(seqPath, "a");
  try {
    if (floor > parseSeq(readFileSync(seqPath, "utf8")).next) {
      writeSync(fd, `# base=${floor}\n`);
    }
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
  const { allocations } = parseSeq(readFileSync(seqPath, "utf8"));
  const mine = allocations.filter((a) => a.nonce === nonce);
  if (mine.length !== 1) {
    throw new Error(
      `lesson-mint: expected exactly 1 line for nonce ${nonce}, found ${mine.length} — ` +
        `the nonce is not unique, so the allocation cannot be identified`,
    );
  }
  return mine[0].n;
}

/** The WRITE gate as a pure function, so it can be tested without git being absent. Returns null
 *  when the command may write, else the reason code the CLI formats.
 *  ⛔ EXTRACTED BECAUSE THE INLINE FORM HAD ZERO COVERAGE, and my own disclosure covered the wrong
 *  half: I said the negative arm cannot live in-process, which is true of the RESOLUTION and false
 *  of the GATE. A six-mutation matrix passed 17/17 with the gate DELETED, with
 *  it INVERTED, and with it re-aimed at `status` leaving writes open; only the resolution wiring and
 *  the SEQ_DEFAULT conjunct went red. A pure function kills the first three. */
export function writeRefusalReason(cmd, source, usable) {
  if (cmd !== "init" && cmd !== "mint") return null;
  if (usable) return null;
  if (source === "fallback") return "unresolved";
  if (source === "rejected") return "not-a-checkout";
  return "wrong-root";
}

function nextFreeFromLedger() {
  // REPO-relative, NOT HERE-relative: this is the DRIFT FLOOR — "not an optimisation, it is the
  // correctness property" per cmdInit below — so it must read the corpus the SHARED ledger belongs
  // to. `cwd: REPO` alone is INERT: check-lesson-numbers.mjs anchors REPO_ROOT to its own
  // import.meta.url and says so in a comment there, so a worktree copy of THIS file spawned the
  // worktree's copy of THAT one and floored the mint on a stale corpus (measured 2026-09-09: a
  // worktree's next-free ran 52 numbers behind the main checkout's, and a rig built to test it
  // produced a real collision). This is also where the two ledger
  // defects MEET: the drift floor is the only runtime defense against a number DERIVED from
  // architecture-counts maxL instead of minted, and in a worktree it was blind — so the earlier
  // claim that the two causes are separate was wrong, and this line is the half that joins them.
  // ⛔ FIX THE CALLER, NEVER THE CHILD: .githooks/pre-push invokes the same script as a GATE over
  // the content being pushed, and there the worktree-local corpus is the correct answer.
  const out = execFileSync("node", [resolve(REPO, "scripts/check-lesson-numbers.mjs")], {
    cwd: REPO,
    encoding: "utf8",
  });
  const m = /next free L(\d+)/.exec(out);
  if (!m) throw new Error("lesson-mint: could not derive next-free from check-lesson-numbers output");
  return Number(m[1]);
}

function cmdInit(seqPath) {
  if (existsSync(seqPath)) {
    const { base, allocations } = parseSeq(readFileSync(seqPath, "utf8"));
    console.log(`lesson-mint: already initialised — base=${base}, ${allocations.length} allocation(s)`);
    return 0;
  }
  // Derived, never typed. ⚠️ This is only the INITIAL floor — `allocate` re-raises it on every
  // mint, and that is not an optimisation, it is the correctness property. The first version of
  // this line froze `base` here and cited a lesson number as if that were the safety argument. The
  // tag was MIS-APPLIED (2026-07-31): that lesson is "an ALWAYS-LOADED rule must carry the
  // INVARIANT, never a perishable LIVE-STATE claim" — nothing to do with deriving vs typing, and
  // read properly it INDICTS the frozen version, because a ledger max frozen into a
  // durable-looking constant is exactly a perishable live-state claim stored where it reads as
  // durable. Two reviewers then verified the frozen base as SAFE, and a citation is precisely
  // what makes a wrong one expensive: an `L#` reads as already-adjudicated by the meta-system
  // rather than as one author's opinion. Cite the claim, not the authority.
  const base = nextFreeFromLedger();
  mkdirSync(dirname(seqPath), { recursive: true });
  const fd = openSync(seqPath, "a");
  writeSync(
    fd,
    `# lesson-seq — append-only L# allocation log. See scripts/lesson-mint.mjs.\n` +
      `# Your L# is the POSITION your line landed in, never a counter you read.\n` +
      `# base=${base}\n`,
  );
  closeSync(fd);
  console.log(`lesson-mint: initialised at ${seqPath} with base=${base}`);
  return 0;
}

function cmdMint(seqPath, argv) {
  const sid = argv[argv.indexOf("--sid") + 1];
  const slugIdx = argv.indexOf("--slug");
  const slug = slugIdx === -1 ? "" : argv[slugIdx + 1];
  if (!sid || argv.indexOf("--sid") === -1) throw new Error("lesson-mint: --sid <sid8> is required");
  if (!slug) throw new Error("lesson-mint: --slug \"<what you are writing>\" is required — it is how a peer sees a CONTENT duplicate before it is written");
  const nonce = `${sid}-${process.pid}-${process.hrtime.bigint()}`;
  const ts = new Date().toISOString();
  const n = allocate(seqPath, { sid, slug, nonce, ts });
  console.log(`L${n}`);
  return 0;
}

function cmdStatus(seqPath) {
  console.log(`repo=${REPO} (${REPO_SOURCE})`);
  if (!existsSync(seqPath)) {
    console.log("lesson-mint: not initialised — run `init`");
    return 1;
  }
  const { base, allocations } = parseSeq(readFileSync(seqPath, "utf8"));
  // TIER UNION (2026-08-06, the meta archive split). MEASURED: reading only the
  // router made `status` report three allocations as IN-FLIGHT when all three had LANDED — their
  // declarations live in an archive tier file and the router carries digests as
  // list rows, never `## L###` headings. Fail-open in the annoying direction: it tells a seat its
  // allocation never landed, which invites a duplicate re-declaration of a number already in use.
  // Same glob as check-lesson-numbers.mjs → memoryTierPaths (one rule, four consumers).
  const metaDir = resolve(REPO, ".claude/skills/meta");
  const mem = existsSync(metaDir)
    ? readdirSync(metaDir)
        .filter((f) => /^MEMORY.*\.md$/.test(f))
        .sort()
        .map((f) => readFileSync(resolve(metaDir, f), "utf8"))
        .join("\n")
    : "";
  // RULES-CORPUS UNION (2026-08-15). MEASURED: `maxL` and this status check both read ONLY the meta
  // corpus, so a lesson HOMED in `.claude/rules/` never raises either — not after it is written, not
  // after it is committed. Five lessons lived in the rules files while the meta headings ran up to
  // just below them and then jumped past; that gap is where a peer's documented fallback
  // allocator (maxL + 1) re-issued five numbers already in use. NOT a race — a deterministic
  // re-issue in which BOTH seats are fully compliant with the written procedure, which is why no
  // amount of care on either side prevents it.
  //
  // The predicate here is deliberately WEAKER than the meta one and that is the point: a rules file
  // cites its lesson inline (`(L<n>, measured ...)`), never as a `## L###` heading, so a
  // heading-anchored test finds nothing. This asks the question the ALLOCATOR actually needs — "is
  // this number IN USE anywhere?" — not "is it declared in canonical form?". A citation of someone
  // else's lesson therefore counts as in-use. That over-matches, and it over-matches in the SAFE
  // direction: the cost is skipping a free number, versus re-issuing a live one.
  const rulesDir = resolve(REPO, ".claude/rules");
  // Bodies also land in the always-loaded ROOT
  // specs (AGENTS.md) + the Band-O file; a rules-dir-only corpus reads
  // them as free and re-issues (the collision class, new home).
  // 2026-09-07: the orchestrator plane is SEVERAL files since the 2026-09-03 dispatch-payload
  // split, not just the Band-O one named here. `check-lesson-numbers.mjs` was widened to a DIR
  // enumeration that day and this allocator was not, so the two instruments disagreed about the
  // same corpus for four days. Measured: two lessons homed in commit-doctrine.md and
  // session-doctrine.md were committed and still read IN-FLIGHT here, while their siblings in `.claude/rules/` read
  // landed — a split by PLANE, which is the tell. Cost is not cosmetic: a number homed on that
  // plane reads FREE to the in-use check, which is the re-issue class above, one home over.
  const orchDir = resolve(REPO, ".claude/orchestrator");
  const orchFiles = existsSync(orchDir)
    ? readdirSync(orchDir).filter((f) => /\.md$/.test(f)).sort().map((f) => `.claude/orchestrator/${f}`)
    : [];
  // THE CORPUS THIS CHECK READS, PRINTED BY `status` SO THE SPEC CAN POINT AT IT RATHER THAN
  // RESTATE IT. `process-learn.md` widened its CONTENT check to
  // four homes and left the NUMBER check at `.claude/rules/` singular, so within EIGHT HOURS the
  // number check was the narrower of the two — those two lessons both read 0 in `.claude/rules/`
  // and 1 in `.claude/orchestrator/`, i.e. FREE to the documented `maxL + 1` fallback, which is
  // the same re-issue class one plane over. Five carriers of one prescription had already
  // drifted. A list printed beside the code that computes it cannot silently disagree with it.
  const IN_USE_CORPUS = [
    ".claude/skills/meta/ (MEMORY.md + MEMORY-ARCHIVE-* + RULES-SHARD-* — the DIR, never the router file alone)",
    ".claude/rules/*.md",
    "AGENTS.md",
    "CLAUDE.md",
    ...orchFiles,
  ];
  const extraInUse = ["AGENTS.md", "CLAUDE.md", ...orchFiles]
    .map((p) => resolve(REPO, p))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const rulesText = (existsSync(rulesDir)
    ? readdirSync(rulesDir)
        .filter((f) => /\.md$/.test(f))
        .sort()
        .map((f) => readFileSync(resolve(rulesDir, f), "utf8"))
        .join("\n")
    : "") + "\n" + extraInUse;
  console.log(`base=${base}  allocations=${allocations.length}`);
  console.log(
    `in-use corpus (${IN_USE_CORPUS.length}) — a number cited in ANY of these is TAKEN:\n` +
      IN_USE_CORPUS.map((p) => `    ${p}`).join("\n"),
  );
  let unlanded = 0;
  for (const a of allocations) {
    const declared =
      new RegExp(`^## .*\\bL${a.n}\\b`, "m").test(mem) ||
      new RegExp(`\\bL${a.n}\\b`).test(rulesText);
    if (!declared) unlanded++;
    console.log(`  L${a.n}  ${declared ? "landed " : "IN-FLIGHT"}  ${a.sid}  ${a.slug}`);
  }
  if (unlanded) {
    console.log(
      `\n⚠ ${unlanded} allocated but not yet declared in MEMORY.md — these are the in-flight slugs.`,
    );
  }
  // The read-them line prints UNCONDITIONALLY and says EVERY slug. Both halves are fixes, 2026-09-07:
  // gating it behind `unlanded` silenced the one instruction that matters exactly when the ledger
  // looked clean, and "the in-flight slugs" excluded the commonest twin BY CONSTRUCTION — a lesson
  // minted hours earlier has landed, so it reads `landed` and an in-flight-scoped read never sees it.
  // Measured: the duplicated pair was minted 11h18m apart by two seats off one incident, so the twin
  // was `landed` the whole time and the number gate stayed green because the numbers differed.
  console.log(
    `\n  BEFORE YOU MINT — GREP THE LEDGER FOR YOUR SUBJECT. It is a flat file of one-line` +
      `\n  subjects, the only corpus here that is cheaply greppable, and it is the one this` +
      `\n  command already prints:` +
      `\n      grep -inF '<one distinctive subject token>' .claude/state/lesson-seq` +
      `\n  Reading all ${allocations.length} slugs above is the IDEAL and will not happen — that is why the` +
      `\n  grep is the step that runs. Measured 2026-09-07: one such grep returned FOUR lessons on` +
      `\n  a single subject spanning three weeks, two of them a same-day duplicate pair that four` +
      `\n  seats had missed while this full list printed on every run.` +
      `\n  A CONTENT duplicate is gate-invisible, and a twin minted hours ago reads \`landed\` — never` +
      `\n  IN-FLIGHT — so an in-flight-scoped read cannot see it. Grep the SUBJECT, never the number.`,
  );
  return 0;
}

// ── self-test: drives the REAL exported functions, on a temp path, with a RED control per claim ──
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "lesson-mint-"));
  const seq = join(dir, "lesson-seq");
  let pass = 0;
  const ok = (name, cond) => {
    if (!cond) throw new Error(`SELF-TEST FAIL: ${name}`);
    pass++;
    console.log(`  ✓ ${name}`);
  };
  try {
    const fd = openSync(seq, "a");
    writeSync(fd, "# base=900\n");
    closeSync(fd);

    // ledgerNextFree is injected throughout so the test never shells out to the real ledger —
    // a self-test that consulted live repo state would drift with the repo and stop being a test.
    const NO_DRIFT = 0;

    // CLAIM 1 — allocation is by POSITION, so N mints yield N DISTINCT numbers.
    const got = [];
    for (let i = 0; i < 25; i++) {
      got.push(allocate(seq, { sid: `s${i}`, slug: `slug ${i}`, nonce: `n${i}`, ts: "t", ledgerNextFree: NO_DRIFT }));
    }
    ok("25 mints yield 25 distinct numbers", new Set(got).size === 25);
    ok("numbers are base-anchored and contiguous", got[0] === 900 && got[24] === 924);

    // RED CONTROL for claim 1 — the OLD protocol (read maxL, take maxL+1) collides on the same
    // file. If this ever stops colliding the test above has stopped proving anything.
    const readThenWrite = () => parseSeq(readFileSync(seq, "utf8")).allocations.length + 900;
    const a = readThenWrite();
    const b = readThenWrite(); // no write in between == the real race window
    ok("RED CONTROL: read-then-write DOES collide (proves the property is non-trivial)", a === b);

    // CLAIM 2 — a nonce collision must THROW, never silently return a wrong number.
    let threw = false;
    try {
      allocate(seq, { sid: "x", slug: "dup", nonce: "n0", ts: "t" });
    } catch {
      threw = true;
    }
    ok("duplicate nonce throws rather than mis-allocating", threw);

    // CLAIM 3 — atomicity precondition is ENFORCED, not assumed.
    let bigThrew = false;
    try {
      assertLineFitsAtomicWrite("x".repeat(PIPE_BUF + 1));
    } catch {
      bigThrew = true;
    }
    ok("over-PIPE_BUF line is rejected", bigThrew);
    ok("normal line is accepted", assertLineFitsAtomicWrite(formatLine({ sid: "s", slug: "hi", nonce: "n", ts: "t" })) < PIPE_BUF);

    // CLAIM 4 — a newline in a slug cannot forge an extra allocation.
    const before = parseSeq(readFileSync(seq, "utf8")).allocations.length;
    allocate(seq, { sid: "s", slug: "evil\nL999\tforged", nonce: "nz", ts: "t" });
    const after = parseSeq(readFileSync(seq, "utf8")).allocations.length;
    ok("newline in slug adds exactly ONE allocation", after === before + 1);

    // CLAIM 5 — POLLUTION: the self-test must not touch the real sequence file.
    ok("self-test never wrote the real seq file", seq !== SEQ_DEFAULT && !seq.includes(".claude/state"));

    // CLAIM 5b — REPO RESOLUTION. A positive control only: run from a live checkout the git
    // resolution MUST succeed, so a wiring inversion (or a REPO that silently fell back here)
    // reads RED. The negative arm cannot live in-process — it needs git to be absent — and is
    // covered by a spawned control recorded in the commit that added the write-refusal.
    ok("repo resolved from git, not from the file path", REPO_FROM_GIT === true && SEQ_DEFAULT.startsWith(REPO));
    ok("resolved root CONTAINS what the tool needs (correctness, not provenance)", REPO_USABLE === true);

    // CLAIM 5c — THE WRITE GATE ITSELF, as a pure function. Six arms: both write verbs refuse in
    // both bad states, neither refuses when usable, and `status` is never gated. These are what go
    // RED if the gate is deleted, inverted, or re-aimed at the wrong command.
    ok("mint refuses on the fallback root", writeRefusalReason("mint", "fallback", false) === "unresolved");
    ok("init refuses on the fallback root", writeRefusalReason("init", "fallback", false) === "unresolved");
    ok("mint refuses when git resolved a root that is not this checkout", writeRefusalReason("mint", "git", false) === "wrong-root");
    ok("a git dir whose basename is not .git is its OWN state, not a git failure", writeRefusalReason("mint", "rejected", false) === "not-a-checkout");
    ok("mint refuses when an OVERRIDE names a root that is not this checkout", writeRefusalReason("mint", "override", false) === "wrong-root");
    ok("mint proceeds on a usable root", writeRefusalReason("mint", "git", true) === null);
    ok("status is never write-gated", writeRefusalReason("status", "fallback", false) === null);

    // CLAIM 5d — THE SHAPE PREDICATE. `endsWith(".git")` and `basename(common) === ".git"` agree on
    // every GOOD state and differ on exactly the two bad ones, which is why the containment check
    // could not carry this load. These arms are what go RED if anyone reverts it.
    ok("a checkout's git dir is accepted", gitDirLooksLikeCheckout("/repo/.git") === true);
    ok("a worktree shares that same dir, so it is accepted too", gitDirLooksLikeCheckout("/srv/repo/.git") === true);
    ok("a BARE repo named *.git is rejected (endsWith would accept)", gitDirLooksLikeCheckout("/x/foo.git") === false);
    ok("a --separate-git-dir store ending .git is rejected (endsWith would accept)", gitDirLooksLikeCheckout("/store/myrepo.git") === false);

    // ── CLAIM 6: DRIFT FLOOR. The sequence is not the only consumer of numbers. ──
    const d = join(dir, "drift-seq");
    const dfd = openSync(d, "a");
    writeSync(dfd, "# base=900\n");
    closeSync(dfd);
    const first = allocate(d, { sid: "a", slug: "before drift", nonce: "d1", ts: "t", ledgerNextFree: 0 });
    ok("pre-drift mint takes the recorded base", first === 900);
    // The LEDGER jumps to 970 — a Step-2b fallback mint, a pull, or a hand renumber.
    const afterDrift = allocate(d, { sid: "b", slug: "after drift", nonce: "d2", ts: "t", ledgerNextFree: 970 });
    ok("drift RAISES the floor (970, not the stale 901)", afterDrift === 970);
    // RED CONTROL: the pre-fix behaviour would have returned 901, colliding with a real lesson.
    ok("RED CONTROL: stale-base behaviour (901) is what we no longer emit", afterDrift !== 901);
    const back = allocate(d, { sid: "c", slug: "ledger behind again", nonce: "d3", ts: "t", ledgerNextFree: 5 });
    ok("a LOWER ledger cannot pull numbers backwards", back === 971);

    // CLAIM 7 — interleaved headers from concurrent seats never collide (raise-only).
    const i2 = join(dir, "interleave");
    const ifd = openSync(i2, "a");
    writeSync(ifd, "# base=900\n");
    writeSync(ifd, formatLine({ sid: "s", slug: "A", nonce: "i1", ts: "t" }));
    writeSync(ifd, "# base=900\n"); // a second seat re-declares the SAME base
    writeSync(ifd, formatLine({ sid: "s", slug: "B", nonce: "i2", ts: "t" }));
    writeSync(ifd, "# base=899\n"); // and a LOWER one arrives late
    writeSync(ifd, formatLine({ sid: "s", slug: "C", nonce: "i3", ts: "t" }));
    closeSync(ifd);
    const inums = parseSeq(readFileSync(i2, "utf8")).allocations.map((a) => a.n);
    ok(`interleaved duplicate/lower headers stay distinct (${inums.join(",")})`, new Set(inums).size === 3);
    ok("and strictly increasing", inums.every((n, k) => k === 0 || n > inums[k - 1]));

    // CLAIM 8 — BACKWARD COMPAT: a single-header file (the format already in use, with a live
    // allocation outstanding) must still number identically to the original base+index scheme.
    const legacy = join(dir, "legacy");
    const lfd = openSync(legacy, "a");
    writeSync(lfd, "# base=962\n");
    for (let i = 0; i < 4; i++) writeSync(lfd, formatLine({ sid: "s", slug: `L${i}`, nonce: `g${i}`, ts: "t" }));
    closeSync(lfd);
    const lnums = parseSeq(readFileSync(legacy, "utf8")).allocations.map((a) => a.n);
    ok(`legacy single-header file numbers unchanged (${lnums.join(",")})`, JSON.stringify(lnums) === JSON.stringify([962, 963, 964, 965]));

    console.log(`\nlesson-mint --self-test: ALL PASS (${pass} assertions)`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Node RESOLVES symlinks for `import.meta.url` but `process.argv[1]` keeps whatever the caller
// typed. Without this guard, IMPORTING this module runs the CLI dispatch below and exits — which
// is exactly how the first concurrency probe returned zero numbers and then PASSED a
// `distinct == total` assertion on 0 == 0.
//
// ⛔ THE FIRST FIX HERE NAMED THE DEFECT CORRECTLY AND PRESCRIBED THE WRONG REMEDY: it said
// "so compare resolved paths" and used `resolve()`, which normalises to absolute and does NOT
// canonicalise symlinks. Diagnosis right, cure inert — measured `status` at 58,339 B by the real
// path and 0 B through a symlink, both rc=0. Canonicalising takes `realpathSync`; SSOT:
// scripts/lib/is-main.mjs.
const IS_MAIN = isMainModule(import.meta.url);

const argv = process.argv.slice(2);
const seqPath = SEQ_DEFAULT;
if (!IS_MAIN) {
  // imported as a library — export only, run nothing
} else try {
  if (argv.includes("--self-test")) process.exit(selfTest());
  const cmd = argv[0];
  const refusal = writeRefusalReason(cmd, REPO_SOURCE, REPO_USABLE);
  if (refusal) {
    const why =
      refusal === "wrong-root"
        ? `${REPO_SOURCE === "override" ? "LESSON_MINT_REPO" : "git"} resolved, but ${REPO} does not contain\n` +
          `  .claude/skills/meta and scripts/check-lesson-numbers.mjs, so it is not this repo's checkout`
        : refusal === "not-a-checkout"
          ? `git ANSWERED — git itself is fine, do not go debugging it — but the common dir it named,\n` +
            `  ${GIT_COMMON}, has a basename other than \`.git\`, so it is not a checkout's git dir\n` +
            `  (a BARE repo named *.git, or a --separate-git-dir store, resolves exactly this way)`
          : `\`git rev-parse --git-common-dir\` failed, so REPO fell back to the file-relative guess ${REPO}\n` +
            `  (a PRUNED worktree, a dubious-ownership refusal under safe.directory, a corrupted .git, or git off PATH)`;
    console.error(
      `✗ lesson-mint: cannot locate the shared repo from ${HERE} — ${why}.\n` +
        `  ${seqPath} may therefore be a PRIVATE ledger, and a number allocated there will collide with\n` +
        `  one the shared ledger has already issued. Refusing to write.\n` +
        `  If you ARE in a good checkout and git is what is broken, name the root explicitly:\n` +
        `    LESSON_MINT_REPO=/path/to/checkout node scripts/lesson-mint.mjs ${cmd} ...\n` +
        `  ⛔ Do NOT fall back to \`maxL + 1\` — that is the collision this gate exists to prevent.`,
    );
    process.exit(1);
  }
  if (cmd === "init") process.exit(cmdInit(seqPath));
  if (cmd === "mint") process.exit(cmdMint(seqPath, argv));
  if (cmd === "status") {
    // ⛔ NON-ZERO WHEN THE ROOT IS NOT USABLE, AND THE ROOT PRINTS IN THE BODY. `status` stays
    // available by design — a refusing minter must still be diagnosable — but it is ALSO the FIRST
    // of the two cross-reads `.claude/skills/meta/references/process-learn.md` mandates before any
    // `maxL + 1` fallback, and the refusal above is what sends a seat down that path. In that state
    // it returned rc=0 over a PRIVATE ledger with its only warning on stderr, so the mandated
    // cross-read could be satisfied silently by a report nobody could tell was rootless.
    // Printing REPO on stdout means the report cannot be quoted without its root.
    if (!REPO_USABLE) console.error(`⚠ lesson-mint: repo unresolved or not this checkout — reading ${seqPath}, which may be a PRIVATE ledger.`);
    const rc = cmdStatus(seqPath);
    process.exit(REPO_USABLE ? rc : rc || 1);
  }
  console.error("usage: lesson-mint.mjs init | mint --sid <sid8> --slug \"<text>\" | status | --self-test");
  process.exit(2); // bare invocation is NON-ZERO (a helpful exit-0 makes every gate above it false-green)
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
