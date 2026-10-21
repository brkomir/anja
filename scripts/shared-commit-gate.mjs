#!/usr/bin/env node
// shared-commit-gate.mjs — answer ONE question before committing a file peers also write:
// "am I about to commit a DELETION I cannot account for?"
//
// WHY THIS EXISTS (measured 2026-07-31, six seats on one tree):
// Two staging methods, opposite failure directions, neither safe alone:
//
//   git add <path> / commit -o <path>   re-read the WORKTREE
//     → risk = SWEEP, sourced from peers' UNCOMMITTED lines. Additive, visible, recoverable.
//   constructed blob + bare commit      uses YOUR reconstruction
//     → risk = REVERT, sourced from peers' COMMITTED lines. Subtractive, INVISIBLE, and
//       indistinguishable from a deliberate deletion in the log.
//
// The revert direction is the dangerous one and only ONE signal sees it: the DELETE COLUMN of
// `git diff --numstat`. Measured live — a peer's blob would have reverted lines committed ninety
// seconds earlier; the blob was well-formed, the construction asserted no bleed, and
// `git status` said nothing useful. Only the delete column knew.
//
// ⛔ DO NOT gate on a `-`-line grep. `^-[^-]` is a structurally UNFALSIFIABLE zero on any file
// whose lines begin `- ` — every row of a checklist file — so it reports 0 whether or not rows were
// deleted. It cannot fail. `--numstat` reads git's own count and has no pattern to be wrong about.
//
// ── WHOSE STALENESS? Non-zero deletions have THREE causes and they want OPPOSITE remedies ──
//   REVISED-IN-PLACE : the removed line is superseded by one you are adding (same opening).
//                      Normal editing. Proceed.
//   YOU-ARMED-IT     : the line is NOT at HEAD — your base predates it, or your blob simply
//                      lacks it. You are about to revert. Rebuild from a fresh HEAD.
//   UNEXPLAINED-DELETION : the line IS at HEAD and you are not replacing it. TWO causes, and
//                      the evidence cannot tell them apart: someone wrote the file from a base
//                      older than that commit (a loss), or someone removed it DELIBERATELY (a
//                      correction). Establish provenance, then restore that ONE line surgically
//                      or override — never overwrite the whole file, which takes uncommitted work.
//                      ⛔ HOW to establish it, and this is the half the first version lacked
//                      (supplied by a peer, 2026-07-31): DO NOT STUDY THE DELETED LINE. Read the lines
//                      ADDED IN THE SAME COMMIT and look for one that REFERENCES it. A
//                      deliberate supersession CITES what it replaces; a blind clobber cites
//                      nothing, because whoever deleted it never HELD the line. That is a real
//                      discriminator ON THE ARTIFACT — it does not need intent, it needs the
//                      OTHER HALF OF THE DIFF, which is the half everyone was ignoring.
//                      ⛔ SCOPE IT: THIS IS A SURVIVAL TEST, NOT AN AUTHORSHIP TEST
//                      (the same peer again, catching their own overreach ~15 min after
//                      supplying the check). It answers DID THE CONTENT SURVIVE and says
//                      NOTHING about WHO WROTE IT — quoting a line you are deleting requires
//                      HOLDING it, not AUTHORING it. Measured on this very block: THREE seats
//                      held three different roles — figure-author, line-author, corrector —
//                      and two of us collapsed them into one by reading a survival test as an
//                      authorship test. Only a git measurement separated them; no amount of
//                      reading the diff would have. The most it supports is "superseded by
//                      someone holding the original."
//                      Measured live: four seats spent a turn each on "is this a lost update?"
//                      over a block that had been REPLACED by a marked, fixture-measured
//                      correction two lines below it. I grepped HEAD, saw my text ABSENT, and
//                      was one command from "surgically restoring" a 50%-wrong estimate over a
//                      real measurement. **ABSENCE IS NOT LOSS.** A presence/absence grep is
//                      structurally incapable of telling them apart; it takes reading forward.
//                      ⚠️ This narrows the "not fixable at the line level" bound below — that
//                      bound is about what THIS TOOL can decide automatically, and it stands.
//                      The discriminator is for the OPERATOR the tool just stopped.
//                      ⛔ Was named `PEER-STALE-BASE` until its first production false positive
//                      (2026-07-31, ~90 min after ship): it fired on a line a peer had
//                      deliberately deleted as a publicly-requested correction. Correct by its
//                      rule, wrong about the world — because the NAME asserted a cause git does
//                      not record. Renamed rather than weakened: the refusal is right, the
//                      diagnosis was unearned. State the observation, not the cause.
//
// ⛔ SCOPE — RUN THIS ON A CONSTRUCTED BLOB, NOT ON ORDINARY EDITING. The gate asks whether a
// deletion is ACCOUNTED FOR, and it has no way to know that a deletion was INTENDED. On a file
// you exclusively own, every deliberate removal you make comes back `UNEXPLAINED-DELETION` — the
// line is at HEAD, you are not replacing it, and that is exactly what an intentional delete
// looks like. Measured on this very commit: running `post` over my own 11-line rewrite flagged
// all 11. That is the tool working and the operator misusing it.
//   USE IT when: you built a blob by hand (`hash-object -w` + `update-index --cacheinfo`) for a
//                file peers are also writing, and every deletion in it should be zero.
//   DO NOT     when: you are editing a file you own — you will train yourself to ignore a red
//                gate, which is worse than not running it (a gate that fires on everything is
//                a disabled gate, and this one has a plausible-sounding verdict for the noise).
//
// Usage:
//   node scripts/shared-commit-gate.mjs check <path>...     # staged vs HEAD (pre-commit)
//   node scripts/shared-commit-gate.mjs post <path>...      # worktree vs HEAD (post-commit)
//   node scripts/shared-commit-gate.mjs --self-test
//
// Exit 0 only when every deletion is accounted for. Bare invocation exits 2 (a helpful
// exit-0 path makes every gate composed above it false-green).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** git's own delete count — no pattern, so nothing to be structurally blind to. */
export function numstat(cwd, args, path) {
  const out = git(cwd, ["diff", "--numstat", ...args, "--", path]).trim();
  if (!out) return { added: 0, deleted: 0 };
  const [a, d] = out.split("\n")[0].split("\t");
  return { added: Number(a) || 0, deleted: Number(d) || 0 };
}

export function removedLines(cwd, args, path) {
  const out = git(cwd, ["diff", ...args, "--", path]);
  return out
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1))
    .filter((l) => l.trim() !== "");
}

export function addedLines(cwd, args, path) {
  const out = git(cwd, ["diff", ...args, "--", path]);
  return out
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/** Split the diff into CHANGE-RUNS: maximal blocks of -/+ lines with no context line between.
 *
 *  ⛔ THIS EXISTS BECAUSE THE FLAT SETS ABOVE FAIL OPEN, MEASURED (2026-07-31, a peer's
 *  fixture reproduced here before folding). `REVISED-IN-PLACE` used to clear a removed line if
 *  ANY added line ANYWHERE in the file shared its prefix — so:
 *      HEAD    - [ ] ROW-A / "    status: pending" / - [ ] ROW-B
 *      staged  - [ ] ROW-A / - [ ] ROW-B / - [ ] MY-ROW / "    status: pending"
 *  reported `ok REVISED-IN-PLACE` and **rc=0 over a real loss**: ROW-A's metadata line is gone,
 *  and it was cleared by MY unrelated new row happening to carry the same boilerplate. On a
 *  formulaic corpus (a checklist file, a lesson file) prefix collisions between unrelated rows are
 *  the NORM, not the exception — so the tool was most blind exactly where it is most used, and
 *  blind in the SUBTRACTIVE direction it exists to catch.
 *
 *  The predicate was always wrong for the name: "revised IN PLACE" means the replacement sits
 *  where the removal was. A genuine rewrite emits a contiguous `-old…+new…` run; a relocation
 *  has a context line between. So locality is not a heuristic here, it is the definition.
 *
 *  ⚠️ THIS NARROWS THE HOLE, IT DOES NOT CLOSE IT — and the residual is now MEASURED rather
 *  than asserted, because a peer reviewer correctly refused to take it on my word: they tried
 *  twice to construct it and BOTH attempts collapsed to a pure insert, then said *"a
 *  documented limitation nobody can trigger is its own kind of wrong."* They were right to
 *  push, and the exchange sharpened the reachability condition to something exact:
 *
 *    removed and added IDENTICAL      → git pairs them as UNCHANGED, emits `+` only.
 *                                       No deletion, nothing to clear. NOT reachable.
 *    divergence BEFORE char PREFIX    → prefixes differ, no match. Correctly refused.
 *    divergence AFTER  char PREFIX    → REACHABLE. Same 55-prefix, different tails, so git
 *                                       emits the `-`/`+` pair in one run and it clears.
 *
 *  Fixture in the self-test (`resid.txt`), verified rc=0 over a genuine loss.
 *
 *  ⛔ STATE IT AS **A LIVE PATH WITH AN UNMEASURED RATE** — not "a known-live gap" (which
 *  overclaims), and NOT "bounded, not reproduced" (which two seats were one message from
 *  writing here, and which is wrong in the direction that matters). The two halves separate:
 *      reachability of the clearing path   ESTABLISHED — my fixture, plus another peer's
 *                                          corpus count: 30 of 120 real change-runs over
 *                                          the last 80 checklist-file commits meet the shape (25%)
 *      false-clear RATE                    UNMEASURED — all 30 look like legitimate in-place
 *                                          revisions, i.e. the TRUE positives this matcher
 *                                          exists to clear. Separating a correct clear from a
 *                                          false one needs INTENT, which git does not record.
 *  What stands between a genuine loss and `✓ clean` is only that nobody clobbered a line
 *  sharing a prefix with something they added in the same run.
 *
 *  The minimal fixtures collapsed because ADJACENT near-identical lines are the one
 *  arrangement git resolves as unchanged; real edits carry churn around the revised line, so
 *  the differ emits the `-`/`+` pair constantly. **The construction difficulty was an
 *  artifact of minimal fixtures, not a property of the world.**
 *
 *  ⛔ AND IT IS NOT FIXABLE AT THE LINE LEVEL. In that fixture the removed line is at HEAD and
 *  the added line is a near-twin — which is STRUCTURALLY IDENTICAL to a legitimate in-place
 *  revision. The only difference is whose line it is, and git records no intent. A tool that
 *  refused this would refuse every genuine revision too. Stated as a bound, not a TODO.
 */
export function changeRuns(cwd, args, path) {
  const out = git(cwd, ["diff", ...args, "--", path]).split("\n");
  const runs = [];
  let cur = null;
  for (const l of out) {
    if (l.startsWith("---") || l.startsWith("+++") || l.startsWith("@@") || l.startsWith("diff ")) {
      cur = null;
      continue;
    }
    const isRem = l.startsWith("-");
    const isAdd = l.startsWith("+");
    if (!isRem && !isAdd) {
      cur = null; // a context line ENDS the run — that is the whole mechanism
      continue;
    }
    if (!cur) {
      cur = { removed: [], added: [] };
      runs.push(cur);
    }
    const body = l.slice(1);
    if (isRem) {
      if (body.trim() !== "") cur.removed.push(body);
    } else {
      cur.added.push(body);
    }
  }
  return runs.filter((r) => r.removed.length > 0);
}

// Enough to identify a line without demanding byte-equality after an edit — and KNOWN to
// under-clear: a rewrite that changes the line's OPENING tokens is a genuine in-place revision
// the prefix cannot see, so it falls through to UNEXPLAINED-DELETION (measured, false positive
// #2, 2026-07-31, a peer replacing their own line in the same commit).
//
// ⛔ THE OBVIOUS REMEDY IS NOT SAFE TO GUESS AT, WHICH IS WHY IT IS NOT HERE. Swapping the
// prefix for a similarity threshold trades this false POSITIVE for a false NEGATIVE on the one
// direction the gate exists to catch: a stale-base revert is invisible and subtractive, and in
// a formulaic corpus (a lesson file, a todo list) an unrelated addition can be similar enough
// to a clobbered peer line to clear it. A threshold picked without the real removed/added pair
// is calibrated on my own reconstruction of the failure — the fixture-mirrors-the-author trap.
// Tracked separately, with the calibration
// corpus named. Until then the verdict names this cause instead of hiding it.
const PREFIX = 55;

/** Classify every deletion. The verdict is COMPUTED from the sets — never printed alongside a
 *  check as a separate statement, which is how a label ends up announcing a result its own
 *  command contradicted.
 *
 *  Takes RUNS (see `changeRuns`), not flat added/removed sets: a removed line may only be
 *  cleared as REVISED-IN-PLACE by an addition inside its OWN run. Passing one run containing
 *  every line reproduces the old file-wide behaviour, which is the measured fail-open — so the
 *  parameter is `runs` and there is no flat-set entry point left to reach for by accident.
 */
export function classify({ runs, headLines }) {
  const headSet = new Set(headLines);
  const out = [];
  for (const run of runs) {
    for (const r of run.removed) {
      if (run.added.some((a) => a.slice(0, PREFIX) === r.slice(0, PREFIX))) {
        out.push({ line: r, verdict: "REVISED-IN-PLACE", safe: true });
      } else if (!headSet.has(r)) {
        out.push({ line: r, verdict: "YOU-ARMED-IT", safe: false });
      } else {
        out.push({ line: r, verdict: "UNEXPLAINED-DELETION", safe: false });
      }
    }
  }
  return out;
}

const REMEDY = {
  "REVISED-IN-PLACE": "your own line, superseded by an addition in the same change — proceed",
  "YOU-ARMED-IT": "not at HEAD: your base is stale. Rebuild the blob from a FRESH `git show HEAD:<path>`",
  // THREE causes, not two. The first wording named a loss and a deliberate correction and
  // shipped an hour before false positive #2 proved the list still incomplete: an author's own
  // IN-PLACE REWRITE lands here whenever the rewrite changes the line's opening tokens, because
  // REVISED-IN-PLACE matches on a PREFIX (see the note at PREFIX). Enumerating the causes I had
  // just been shown, and stopping there, is the same shape as the diagnosis this verdict was
  // renamed for — so the wording now says what is observed and asks, rather than listing.
  "UNEXPLAINED-DELETION":
    "at HEAD and not replaced. Could be a stale base (a loss), a deliberate removal (a correction), or your own in-place rewrite that changed the line's opening. TO ESTABLISH PROVENANCE, DO NOT STUDY THE DELETED LINE — read the lines ADDED IN THE SAME COMMIT and look for one that REFERENCES it: a deliberate supersession CITES what it replaces, a blind clobber cites nothing because whoever deleted it never HELD the line. NOTE THE SCOPE: this answers DID THE CONTENT SURVIVE, never WHO WROTE IT — quoting a line you delete requires holding it, not authoring it. Then restore that ONE line surgically, or override and say so. Never overwrite the file",
  "CANNOT-VERIFY": "run this from the repo the paths belong to, and check the path for a typo/rename. NOT a pass — the gate refuses to certify what it cannot read",
};

function run(cwd, mode, paths) {
  const args = mode === "check" ? ["--cached"] : [];
  let bad = 0;
  for (const p of paths) {
    const ns = numstat(cwd, args, p);
    // ⛔ EMPTY PLANE — `check` reads the INDEX (`--cached`), so running it BEFORE `git add`
    // inspects an empty index and reports a clean bill over a dirty worktree. The gate is
    // correct and useless, and "no deletions — nothing to account for" is indistinguishable
    // from a real pass. Measured on myself, 2026-07-31: `check` said clean while
    // `git diff --numstat` on the same path said `1 1`. Fourth plane error of the night —
    // the instrument reading a different surface than the one the truth is on.
    //
    // So say WHICH PLANE WAS EMPTY, and refuse: a helpful quiet path makes every gate
    // composed above this one false-green, and the whole point of `check` is to run before a
    // commit — i.e. exactly when forgetting to stage is most likely.
    if (ns.added === 0 && ns.deleted === 0) {
      const other = numstat(cwd, mode === "check" ? [] : ["--cached"], p);
      if (other.added || other.deleted) {
        console.log(`${p}  (nothing on the ${mode === "check" ? "INDEX" : "WORKTREE"} plane)`);
        console.log(
          `  ⛔ WRONG-PLANE  this path has +${other.added} -${other.deleted} on the ${mode === "check" ? "WORKTREE" : "INDEX"} plane, and 0 here`,
        );
        console.log(
          mode === "check"
            ? "      → `check` compares the INDEX to HEAD. `git add` the path first, or use `post` to read the worktree."
            : "      → `post` compares the WORKTREE to HEAD. Your changes are staged; use `check`.",
        );
        bad += 1;
        continue;
      }
    }
    const runs = changeRuns(cwd, args, p);
    // ⛔ THE HEAD READ THROWS FOR AT LEAST THREE REASONS AND ONLY ONE OF THEM IS SAFE.
    //   genuinely new file       → no prior content, so no deletion is possible → clean
    //   path typo / wrong repo   → we cannot classify anything → FINDING
    //   unborn HEAD / not a repo → same → FINDING
    // The discriminator costs nothing and is already in hand: `ns.deleted`, computed four
    // lines up. If numstat counted deletions, prior content demonstrably EXISTS, so
    // "new file — no deletions possible" is falsified by this function's own earlier read.
    //
    // ⛔ AND THAT SENTENCE DOES NOT SURVIVE THE INCIDENT NARRATED BELOW — read the bound
    // before trusting the mechanism. `ns` is computed with the SAME cwd as the failing read
    // (`numstat(cwd, …)` at :102), so when cwd is wrong numstat reads a different repo,
    // returns `+0 -0`, and `ns.deleted > 0` is false: **a guard whose discriminator is
    // computed by the broken instrument cannot fire.** It is correct GIVEN a trustworthy
    // cwd and inert without one — which is why the entrypoint fix is not optional garnish,
    // and why check (2) below exists to catch what this one structurally cannot.
    //
    // ⛔ THIS SHIPPED FAIL-OPEN AND THE DEFECT WAS *NOT* THE cwd (2026-07-31, twenty minutes
    // between the ship and the repro). My first framing had the two composing — wrong
    // cwd → throw → swallowed — which made it look like fixing the entrypoint fixed both.
    // A peer reviewer cut that apart at the source: they are INDEPENDENT, and only one lives in
    // the entrypoint. With cwd fully correct, a typo'd path still returns ✓ CLEAN. The repro
    // is the whole argument: numstat returned `1 1` and the gate printed "no deletions
    // possible" in the same loop iteration — two instruments disagreeing, and the one that
    // measured nothing decided the verdict (the disagreement IS the signal).
    //
    // The old self-test could not reach this: every arm called run() with an explicit cwd and
    // none exercised argv, so the tests were structurally blind to the entrypoint — and the
    // new-file arm asserted the THROW IS REAL, which tests that the mechanism fires, never
    // that the verdict is right. Same shape as check-lesson-numbers' missing-file exit-0.
    let headLines = [];
    try {
      // stderr is CAPTURED, not discarded: the absent-from-HEAD case is expected and handled,
      // so git's `fatal:` must not reach the terminal (a handled condition printing an error
      // makes a clean run read as failed) — but when we DO refuse, git's own message names
      // which of the three causes it was, and throwing that away costs the diagnosis.
      headLines = execFileSync("git", ["show", `HEAD:${p}`], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      }).split("\n");
    } catch (e) {
      const why = String(e.stderr || "").trim().split("\n")[0] || "(git gave no reason)";
      const refuse = (headline) => {
        console.log(`${p}  +${ns.added} -${ns.deleted}`);
        console.log(`  ⛔ CANNOT-VERIFY  ${headline}`);
        console.log(`      git: ${why}`);
        console.log(`      → ${REMEDY["CANNOT-VERIFY"]}`);
        bad += 1;
      };
      // (1) INSTRUMENT DISAGREEMENT. numstat counted deletions, so prior content exists and
      // "new file" is false. Reachable and natural: run the gate from a SUBDIRECTORY and
      // numstat resolves the path against cwd (`sub/f.txt`) while `git show HEAD:` resolves
      // against the repo ROOT (`f.txt`) — measured, git even says so in the stderr we keep.
      if (ns.deleted > 0) {
        refuse(`numstat counted ${ns.deleted} deletion(s), but HEAD has no such path`);
        continue;
      }
      // (2) UNKNOWN PATH. ns.deleted === 0 does NOT mean "new file" — numstat is blind to a
      // path git has never heard of, so a typo returns the same 0 as a genuine addition.
      //
      // ⚠️ Check (1) alone does NOT close this, and both a peer's mail and my own first
      // comment claimed it did ("even with cwd correct, a typo'd path still returns ✓ CLEAN"
      // — true, and it stays true after the ns.deleted guard, which is the half that mail got
      // wrong). The measurement is what separated them: in the original repro numstat ran in
      // the WRONG repo too and returned 0/0, so the guard would have passed it through. A
      // genuinely-new file IS in the index; a typo is not. That is the discriminator.
      let known = true;
      try {
        // stdio pipe, not the shared `git` helper: a MISS here is an expected, handled
        // outcome, and letting git's `error: pathspec …` reach the terminal makes a run the
        // gate handled correctly read as a run that broke — the misleading-output class this
        // whole file exists inside, reproduced by its own probe.
        execFileSync("git", ["ls-files", "--cached", "--error-unmatch", "--", p], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        known = false;
      }
      if (!known) {
        refuse("git does not know this path at all — not in HEAD, not in the index");
        continue;
      }
      console.log(`${p}  (new file — in the index, absent from HEAD, 0 deletions)`);
      continue;
    }
    const rows = classify({ runs, headLines });
    const unsafe = rows.filter((r) => !r.safe);
    console.log(`${p}  +${ns.added} -${ns.deleted}`);
    for (const r of rows) {
      console.log(`  ${r.safe ? "ok " : "⛔"} ${r.verdict}  ${r.line.slice(0, 76)}`);
      if (!r.safe) console.log(`      → ${REMEDY[r.verdict]}`);
    }
    if (ns.deleted === 0) console.log("  no deletions — nothing to account for");
    bad += unsafe.length;
  }
  console.log(bad === 0 ? "\n✓ every deletion accounted for" : `\n✗ ${bad} unaccounted deletion(s)`);
  return bad === 0 ? 0 : 1;
}

// ── self-test: real git repos in temp dirs, one RED control per verdict class ──
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "scg-"));
  let pass = 0;
  const ok = (n, c) => {
    if (!c) throw new Error(`SELF-TEST FAIL: ${n}`);
    pass++;
    console.log(`  ✓ ${n}`);
  };
  try {
    const repo = join(dir, "r");
    mkdirSync(repo);
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    const f = join(repo, "shared.txt");
    writeFileSync(f, "alpha\nbravo\ncharlie\n");
    git(repo, ["add", "shared.txt"]);
    git(repo, ["commit", "-qm", "base"]);

    // numstat reads git's count, not a pattern — the `- `-prefixed corpus that defeats `^-[^-]`.
    writeFileSync(f, "- [ ] one\n- [ ] two\n");
    git(repo, ["add", "shared.txt"]);
    const ns = numstat(repo, ["--cached"], "shared.txt");
    ok(`numstat sees deletions on a '- ' corpus (+${ns.added} -${ns.deleted})`, ns.deleted === 3);
    // RED CONTROL: the pattern-based gate this replaces reports ZERO on that same corpus.
    const patternGate = removedLines(repo, ["--cached"], "shared.txt").filter((l) => /^-[^-]/.test(l));
    ok("RED CONTROL: `^-[^-]` reports 0 on the same real deletions", patternGate.length === 0);

    // classify: one case per verdict, each decided by the fixture and not by the tool.
    const head = ["alpha", "bravo", "charlie"];
    const c1 = classify({ runs: [{ removed: ["alpha is old"], added: ["alpha is new and longer"] }], headLines: head });
    ok("YOU-ARMED-IT when the removed line is absent from HEAD", c1[0].verdict === "YOU-ARMED-IT");
    const c2 = classify({ runs: [{ removed: ["bravo"], added: ["zulu"] }], headLines: head });
    ok(
      "UNEXPLAINED-DELETION when it IS at HEAD and unreplaced (cause-neutral: a loss and a\n     deliberate correction are indistinguishable here — the verdict must not claim which)",
      c2[0].verdict === "UNEXPLAINED-DELETION",
    );
    const long = "x".repeat(PREFIX);
    const c3 = classify({ runs: [{ removed: [long + " old tail"], added: [long + " new tail"] }], headLines: head });
    ok("REVISED-IN-PLACE when an addition shares the opening", c3[0].verdict === "REVISED-IN-PLACE");
    ok("only REVISED-IN-PLACE is safe", c3[0].safe && !c1[0].safe && !c2[0].safe);

    // A clean change must NOT be flagged — a gate that fails everything is a disabled gate.
    const c4 = classify({ runs: [{ removed: [], added: ["brand new"] }], headLines: head });
    ok("pure append yields zero findings", c4.length === 0);

    // RUN-LOCALITY: the same (removed, added) pair clears in ONE run and REFUSES across TWO.
    // This pair IS the fail-open — flattening the runs is what shipped rc=0 over a real loss.
    const collide = "    status: pending";
    const oneRun = classify({ runs: [{ removed: [collide], added: [collide] }], headLines: [collide] });
    const twoRuns = classify({
      runs: [{ removed: [collide], added: [] }, { removed: [], added: [collide] }],
      headLines: [collide],
    });
    ok("same run: a prefix-matching addition clears the removal", oneRun[0].verdict === "REVISED-IN-PLACE");
    ok(
      "DIFFERENT runs: the identical pair does NOT clear (this is fail-open #3)",
      twoRuns[0].verdict === "UNEXPLAINED-DELETION",
    );

    // NEW FILE: `git show HEAD:<path>` aborts for a path absent from HEAD. Found by running
    // this gate on its OWN first commit — it died before checking anything.
    writeFileSync(join(repo, "brand-new.txt"), "hello\n");
    git(repo, ["add", "brand-new.txt"]);
    let newFileThrew = false;
    try {
      git(repo, ["show", "HEAD:brand-new.txt"]);
    } catch {
      newFileThrew = true;
    }
    ok("RED CONTROL: `git show HEAD:<new file>` does throw (the crash is real)", newFileThrew);
    ok(
      "run() survives a new file instead of aborting the whole check",
      run(repo, "check", ["brand-new.txt"]) === 0,
    );

    // ── the two FAIL-OPEN arms (2026-07-31) ──────────────────────────────────────────────
    // Both of these returned 0 — "✓ every deletion accounted for" — before the fix. The old
    // new-file arm above could not catch either: it asserts the THROW IS REAL, which proves
    // the MECHANISM fires, never that the VERDICT is right. Every arm here asserts a VERDICT.

    // (1) INSTRUMENT DISAGREEMENT, reachable without any bug: from a SUBDIRECTORY numstat
    // resolves against cwd and `git show HEAD:` against the repo root. Measured, not assumed.
    const sub = join(repo, "sub");
    mkdirSync(sub);
    writeFileSync(join(sub, "f.txt"), "alpha\nbravo\n");
    git(repo, ["add", "sub/f.txt"]);
    git(repo, ["commit", "-qm", "sub base"]);
    writeFileSync(join(sub, "f.txt"), "zulu\n");
    git(repo, ["add", "sub/f.txt"]);
    const subNs = numstat(sub, ["--cached"], "f.txt");
    ok(`RED CONTROL: numstat from the subdir DOES see the deletions (-${subNs.deleted})`, subNs.deleted === 2);
    let showFromSubThrew = false;
    try {
      git(sub, ["show", "HEAD:f.txt"]);
    } catch {
      showFromSubThrew = true;
    }
    ok("RED CONTROL: `git show HEAD:f.txt` from the subdir throws (root-relative)", showFromSubThrew);
    ok(
      "VERDICT: real deletions + unreadable HEAD path is REFUSED, not certified clean",
      run(sub, "check", ["f.txt"]) === 1,
    );

    // (2) UNKNOWN PATH — the half `ns.deleted` structurally cannot close, because numstat is
    // just as blind to a typo as `git show` is: it reports NOTHING, so ns.deleted === 0 and
    // check (1) waves it through. This arm is why check (2) exists.
    const typoNs = numstat(repo, ["--cached"], "no-such-file.txt");
    ok("RED CONTROL: numstat reports 0 deletions for a typo'd path (guard 1 is blind)", typoNs.deleted === 0);
    ok(
      "VERDICT: a path git has never heard of is REFUSED, not called a new file",
      run(repo, "check", ["no-such-file.txt"]) === 1,
    );
    ok(
      "and a GENUINELY new file is still clean — the gate did not just start failing everything",
      run(repo, "check", ["brand-new.txt"]) === 0,
    );

    // (3) ENTRYPOINT / argv. The arms above all call run() with an explicit cwd, which is
    // exactly the blindness that let the entrypoint ship broken — so this one spawns the
    // real CLI as a child process and lets it resolve its own cwd. Before the fix it audited
    // the script's OWN repo regardless of where it was invoked from.
    // Re-stage the deletion first. The `git commit -qm "sub base"` above is a BARE commit, so
    // it swept the still-staged shared.txt into itself and left nothing for this arm to find
    // — biting inside the test fixture for the gate that exists to catch shared-index
    // accidents. The arm went GREEN-looking-RED for the wrong reason, which is its own tell.
    writeFileSync(f, "only\n");
    git(repo, ["add", "shared.txt"]);
    const argvNs = numstat(repo, ["--cached"], "shared.txt");
    ok(`RED CONTROL: the argv fixture really has staged deletions (-${argvNs.deleted})`, argvNs.deleted > 0);

    // (6) WRONG-PLANE. `check` reads the INDEX; running it before `git add` inspects an empty
    // index and used to print "no deletions — nothing to account for" over a dirty worktree.
    // Found by dogfooding this gate on my own commit, which is the only way it would have been.
    const plane = join(repo, "plane.txt");
    writeFileSync(plane, "alpha\nbravo\n");
    git(repo, ["add", "plane.txt"]);
    git(repo, ["commit", "-qm", "plane base", "--", "plane.txt"]);
    writeFileSync(plane, "alpha\nzulu\n"); // dirty WORKTREE, deliberately NOT staged
    ok(
      "RED CONTROL: nothing is staged for the path (index plane genuinely empty)",
      numstat(repo, ["--cached"], "plane.txt").deleted === 0,
    );
    ok(
      "VERDICT: `check` on an unstaged path REFUSES (wrong plane) instead of certifying clean",
      run(repo, "check", ["plane.txt"]) === 1,
    );
    ok(
      "and `post` — the correct plane for an unstaged change — still classifies it",
      run(repo, "post", ["plane.txt"]) === 1,
    );

    const cli = fileURLToPath(import.meta.url);
    const spawnGate = (atCwd, args) => {
      try {
        execFileSync(process.execPath, [cli, ...args], { cwd: atCwd, encoding: "utf8", stdio: "pipe" });
        return { rc: 0 };
      } catch (e) {
        return { rc: e.status, out: String(e.stdout || "") };
      }
    };
    // (4) FAIL-OPEN #3 END-TO-END, through the real diff parser rather than hand-built runs.
    // A peer's fixture, verbatim: a metadata line is lost from ROW-A while an unrelated NEW
    // row carries the same boilerplate. Before run-locality this printed `ok REVISED-IN-PLACE`
    // and exited 0 — a certified clean over a genuine loss. Two peers then measured
    // the collision population in the real checklist file: 128 classes, `meta:` x393, `status:
    // pending` x99. The collision is the FILE'S SCHEMA, so this was reachable by an ordinary
    // edit, not an adversarial one — and the lines most at risk are exactly `trigger-type:` /
    // `status:` / `blocked-on:`, i.e. a defer trigger silently reverting to a stale value,
    // certified by the guard built to catch that (the failure arriving THROUGH the instrument).
    const fo3 = join(repo, "fo3.txt");
    writeFileSync(fo3, "- [ ] ROW-A\n    status: pending\n- [ ] ROW-B\n");
    git(repo, ["add", "fo3.txt"]);
    git(repo, ["commit", "-qm", "fo3 base", "--", "fo3.txt"]);
    writeFileSync(fo3, "- [ ] ROW-A\n- [ ] ROW-B\n- [ ] MY-ROW\n    status: pending\n");
    git(repo, ["add", "fo3.txt"]);
    const fo3ns = numstat(repo, ["--cached"], "fo3.txt");
    ok(`RED CONTROL: the fixture stages a real deletion (-${fo3ns.deleted})`, fo3ns.deleted === 1);
    ok("VERDICT: a cross-run prefix collision does NOT certify the loss clean", run(repo, "check", ["fo3.txt"]) === 1);

    // (5) CHARACTERIZATION of the KNOWN RESIDUAL — this arm asserts the CURRENT (wrong-ish)
    // behaviour on purpose, so the hole is tested rather than merely claimed in a comment.
    // ⚠️ IF YOU MAKE THIS ARM FAIL, YOU HAVE CLOSED THE HOLE — update the comment above and
    // flip this to expect 1. Do NOT "fix" it by deleting the arm.
    //
    // Two seats independently tried to reach this and BOTH collapsed, then reasonably
    // concluded the defect might be structurally self-limiting. It is not: their fixtures
    // used IDENTICAL lines, which git pairs as unchanged and emits as a pure insert. The
    // reachability condition is near-identical — divergence AFTER the prefix window — which
    // on a real checklist metadata line is the common case.
    const resid = join(repo, "resid.txt");
    writeFileSync(resid, "- [ ] ROW-A\n    status: pending, blocked-on: none, owner: unassigned - peer A tail\n- [ ] ROW-B\n");
    git(repo, ["add", "resid.txt"]);
    git(repo, ["commit", "-qm", "resid base", "--", "resid.txt"]);
    writeFileSync(resid, "- [ ] ROW-A\n- [ ] MY-ROW\n    status: pending, blocked-on: none, owner: unassigned - my own tail\n- [ ] ROW-B\n");
    git(repo, ["add", "resid.txt"]);
    ok(
      `RED CONTROL: the residual fixture stages a real deletion (-${numstat(repo, ["--cached"], "resid.txt").deleted})`,
      numstat(repo, ["--cached"], "resid.txt").deleted === 1,
    );
    ok(
      "KNOWN HOLE (characterized, not endorsed): a same-run near-twin still clears — rc=0 over a real loss",
      run(repo, "check", ["resid.txt"]) === 0,
    );

    const spawned = spawnGate(repo, ["check", "shared.txt"]);
    ok(
      "VERDICT via argv: the CLI audits the CALLER's repo, not its own (found the staged deletions)",
      spawned.rc === 1 && /shared\.txt/.test(spawned.out || ""),
    );
    ok("VERDICT via argv: a clean path through the real CLI still exits 0", spawnGate(repo, ["check", "brand-new.txt"]).rc === 0);

    console.log(`\nshared-commit-gate --self-test: ALL PASS (${pass} assertions)`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `resolve()` normalises to absolute but does NOT canonicalise symlinks, so the naive compare was
// FALSE through any symlinked path and this gate defined everything and ran NOTHING at rc=0
// (measured: real path 5116 B, symlinked 0 B). SSOT: scripts/lib/is-main.mjs.
const IS_MAIN = isMainModule(import.meta.url);
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  try {
    if (argv.includes("--self-test")) process.exit(selfTest());
    const mode = argv[0];
    const paths = argv.slice(1).filter((a) => !a.startsWith("--"));
    if ((mode === "check" || mode === "post") && paths.length) {
      // THE CALLER'S cwd, never the script's own repo. The original line resolved to this
      // file's `../` — so the gate silently audited the repo it lives in while the user was
      // standing in another one, and every path came back "not in HEAD". Independent of the
      // fail-open above: each defect returns ✓ CLEAN on its own.
      process.exit(run(process.cwd(), mode, paths));
    }
    console.error("usage: shared-commit-gate.mjs check|post <path>... | --self-test");
    process.exit(2);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
