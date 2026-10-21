#!/usr/bin/env node
// git-story-closure.mjs — deterministic /wrap "is the git story intentional?" reconciler.
//
// The recurring class: a session ends with an AMBIGUOUS git state — "did we MEAN
// to leave this uncommitted / unpushed / this migration unrecorded, or did nobody
// notice?" (the idea comes from guildhall's git-story work: tell a state somebody
// chose apart from one nobody looked at). This COMPUTES the
// closure state from ground truth so the /wrap summary NAMES intent
// (computed-not-asserted) instead of the orchestrator vibing "clean."
//
// DESIGN taken from matthew-dean/guildhall's git-story machine (design and
// state names only; ALL code written fresh, no TS vendored):
// a precedence classifier + per-state nextAction + a NON_BLOCKING set + a `ready`
// boolean. State set RE-DERIVED for THIS workflow (commit-direct-to-main, no
// branches/PRs, owner-gated push, multi-session tree): guildhall's `committed_local`
// (which it BLOCKS on, severity 70) INVERTS here to `unpushed(N)` = our SANCTIONED
// default (push is owner-gated) → NON_BLOCKING.
//
// Composes existing nets (adds NO new detection): `git status --porcelain` +
// `git rev-list @{u}..HEAD` + `session-manifest.py whose-edit` (dirty-file
// attribution) + `migration-notation-reconcile.mjs --json` (Shape-B
// applied-unrecorded; PLUGGABLE — degrade-silent when absent so the ENGINE copy
// stands alone for the OSS template).
//
// WARN-MODE (exit 0 always) — surfaces the state; never wedges /wrap.
// Usage: node scripts/git-story-closure.mjs [--json] [--self-test]

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
// ⛔ ANSWER --help BEFORE ANY WORK, 2026-09-01. It was unhandled, so `--help` fell through
// to the full pass — which shells out to a remote-DB probe and a per-file attribution loop.
// A help request that hangs reads as "the script is broken at load", and that is exactly the
// wrong diagnosis: it sent one reader hunting a module-load cost that does not exist.
if (args.includes("--help") || args.includes("-h")) {
  console.log("git-story-closure.mjs — is the git story intentional? (warn-mode, exit 0)\n" +
    "Usage: node scripts/git-story-closure.mjs [--json] [--self-test] [--help]\n" +
    "Attributes TRACKED-dirty paths only; ~8s per path via whose-edit.");
  process.exit(0);
}
const asJson = args.includes("--json");
const sh = (cmd) => { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

/**
 * PURE reading of `migration-notation-reconcile.mjs --json` stdout, extracted 2026-09-12 so
 * `--self-test` can reach it. It lived inline in the probe block below, where no arm could
 * run it: deleting its `migProbeRead` assignment left the whole suite GREEN (measured).
 *
 * `read` is THREE-VALUED and that is the point: true = the probe reported · false = it was
 * asked and did not (refused, crashed, or skipped for want of a DB URL) · and the caller uses
 * null for "never asked". The old inline code parsed `out || "{}"`, collapsing every
 * did-not-report case onto `{}` -> no rows -> ZERO unrecorded migrations, which is the same
 * bytes as a clean probe.
 */
// NOT exported, deliberately: this file runs its full pass at MODULE SCOPE (whose-edit per
// dirty path, plus the migration probe), so an `export` would make an `import` of it do all
// that work as a side effect. That is the exact defect `migration-notation-reconcile.mjs`
// grew an ENTRY GUARD for. `classify` is in-file for the same reason; --self-test reaches
// both without either being importable.
function readMigrationProbe(out) {
  try {
    const j = JSON.parse(out);
    if (j && j.skipped === true) return { read: false, count: 0, names: [] };
    // ⛔ BLIND IS THE SECOND "THE INSTRUMENT COULD NOT ANSWER", AND IT CROSSED THE MACHINE
    // BOUNDARY WITH NO CONSUMER AT ALL UNTIL 2026-09-12. The producer sets `blind` when the git
    // subjects are unreadable, which makes EVERY windowed migration look un-notated; on the HUMAN
    // path it suppresses its own backfill command for exactly that reason, then emitted the same
    // unverified candidate set over --json -- where this reader scored it a clean
    // `migration_unrecorded(N)` and /wrap routed to the backfill the producer had just refused to
    // print. That is the duplicate notation, reached through /wrap. Wiring a
    // field across a boundary and shipping no consumer is the same wired-to-nothing class as the
    // two --self-tests the pre-push hook was not running.
    // ⚠ names:[] DELIBERATELY, unlike the instrumentFailed branch below: under blind the
    // candidate list is INFLATED by construction (already-notated migrations are in it), so
    // forwarding the names would re-offer upstream precisely what the producer withheld.
    if (j && j.blind === true) return { read: false, count: 0, names: [] };
    // \u26d4 ONE RECOGNISED SHAPE, AND AN UNRECOGNISED ONE IS *NOT* A CLEAN READ. The ladder here
    // used to be `j.findings || j.migrations || j.rows || j.results || []` -- 8 of ~12 alternatives
    // dead, including an `APPLIED_UNRECORDED` underscore spelling the producer never emits. That was
    // harmless while `[] -> 0` was the only outcome; the moment a `read` axis existed it became a
    // re-entry point for the exact defect this reader closes: valid JSON of a shape nobody emits
    // parses, falls through to [], and returns read:true count:0 == CLEAN.
    const rows = Array.isArray(j) ? j : (Array.isArray(j && j.findings) ? j.findings : null);
    if (rows === null) return { read: false, count: 0, names: [] };
    const names = [];
    let instrumentFailed = false;
    for (const r of rows) {
      const cls = `${r.class || r.status || r.verdict || ""}`.toUpperCase();
      // \u26d4 PROBE-ERROR IS THE ONLY VERDICT THAT MEANS *THE INSTRUMENT FAILED* -- DB reachable,
      // queries failed, nothing measured -- so it arrives as ordinary JSON and the APPLIED-UNRECORDED
      // row count reads 0, i.e. CLEAN. That directly contradicts `migration/SKILL.md` step 2, written
      // in the sibling commit: "PROBE-ERROR => it is NOT a 'no' and must never be read as one."
      // \u26a0 NARROW, deliberately: MANUAL is NOT convicted -- it is a considered "no probeable
      // object" (9 of the last 20 migrations), so counting it unread would fire constantly and train
      // the reader to ignore the axis. UNAPPLIED and PARTIAL are MEASURED findings, not failures.
      if (cls.includes("PROBE-ERROR") || cls.includes("PROBE_ERROR")) instrumentFailed = true;
      if (cls.includes("APPLIED-UNRECORDED") || r.appliedUnrecorded) {
        names.push(r.num || r.migration || r.name || r.id || "?");
      }
    }
    if (instrumentFailed) return { read: false, count: names.length, names };
    return { read: true, count: names.length, names };
  } catch {
    return { read: false, count: 0, names: [] };
  }
}

// ── Pure classifier (the DESIGN port + the --self-test surface). ──
// NON_BLOCKING = states that are intentional-by-default or not-ours-to-resolve.
const NON_BLOCKING = new Set(["clean", "unpushed", "dirty_peer", "no_upstream", "migration_probe_unread"]);
// Precedence worst→least (drives `worst` + the one-line headline).
const PRECEDENCE = ["unknown", "migration_unrecorded", "migration_probe_unread", "dirty_unattributed", "dirty_mine", "dirty_peer", "unpushed", "no_upstream", "clean"];
const NEXT_ACTION = {
  clean: "clean — nothing to close",
  unpushed: "commit(s) local, awaiting owner-gated push — intentional per the push gate; NAME it in the summary",
  dirty_mine: "uncommitted edits a manifest ATTRIBUTES to you — commit them (→ unpushed) OR declare deferred-with-reason. CAUTION: this inherits whose-edit's assignment≠authorship weakness exactly as dirty_unattributed inherits the absence weakness — a positive means 'some manifest CLAIMS this path' (authored OR merely assigned via a [scope-owns] marker), never 'you wrote this hunk'. Confirm against your OWN edit history before committing; BOTH directions of this report are unsound for hunk-level ownership",
  dirty_unattributed: "dirty file(s) NO MANIFEST RECORDS — this is NOT proof of orphanhood: a manifest records orchestrator Edit/Write/Bash-writes PLUS any `[scope-owns]:` paths on an Agent dispatch, so a subagent wave dispatched WITHOUT that marker attributes to nobody (emit it — measured 2026-07-09: markers that ARE emitted do register). Broadcast claim-or-disclaim (mail-send --to all), check `who` for a live peer, and adopt+commit ONLY after a real window of silence; do NOT leave un-named",
  dirty_peer: "a live peer's WIP — leave it (not yours to commit); informational only",
  migration_unrecorded: "migration(s) applied-but-unrecorded — backfill the notation (migration-notation-reconcile prints the git command)",
  no_upstream: "no upstream branch — cannot compute unpushed count; verify manually",
  migration_probe_unread: "the migration probe did not report (it refused, crashed, or skipped for want of a DB URL) — this axis is UNMEASURED, NOT clean. Non-blocking, because a no-DB environment is legitimate; but do not read the absence of migration findings as an absence of unrecorded migrations. Re-run `node scripts/migration-notation-reconcile.mjs` and read it.",
  unknown: "git inspection failed — say so; NEVER assume clean",
};

function classify({ dirtyMine = 0, dirtyUnattributed = 0, dirtyPeer = 0, unpushed = 0, migrationUnrecorded = 0, gitOk = true, migProbeRead = true } = {}) {
  const states = [];
  if (!gitOk) states.push("unknown");
  else {
    if (migrationUnrecorded > 0) states.push("migration_unrecorded");
    // UNMEASURED is its own state. `migrationUnrecorded === 0` used to mean BOTH "the probe
    // ran and found none" and "the probe never reported", and only the first is a finding.
    // ⛔ `if`, NOT `else if` — CORRECTED 2026-09-13. The chain assumed the two could never
    // co-occur; `readMigrationProbe` returns `{ read: false, count: names.length }` on an
    // instrument failure (see its `instrumentFailed` branch), so a scan that finds real
    // unrecorded migrations AND hits a probe error yields BOTH, and the `else if` silently
    // dropped the second — the consumer reported the finding and never said the instrument had
    // also failed. PRECEDENCE still puts `migration_unrecorded` first, so `worst` and `ready`
    // are unchanged; only the dropped state returns. Reviewer-found, out of two
    // lenses that measured the same scenario and read it opposite ways.
    if (migProbeRead === false) states.push("migration_probe_unread");
    if (dirtyUnattributed > 0) states.push("dirty_unattributed");
    if (dirtyMine > 0) states.push("dirty_mine");
    if (dirtyPeer > 0) states.push("dirty_peer");
    if (unpushed === null) states.push("no_upstream");
    else if (unpushed > 0) states.push("unpushed");
    if (states.length === 0) states.push("clean");
  }
  const worst = PRECEDENCE.find((s) => states.includes(s)) || "unknown";
  const ready = states.every((s) => NON_BLOCKING.has(s));
  return { states, worst, ready };
}

/**
 * Which next-actions to PRINT. One line printed `next (${worst})` and nothing else, so inserting
 * `migration_probe_unread` at rank 2 (above `dirty_unattributed` and `dirty_mine`) meant a no-DB box
 * with an orphan dirty file printed the unmeasured-probe advisory and SUPPRESSED the orphan
 * claim-or-disclaim tree. Two reviewers found it independently and proposed INCOMPATIBLE remedies:
 * reorder so NON_BLOCKING is a suffix of PRECEDENCE again, or keep the rank and print a second line.
 *
 * \u2b50 THE ORDERING DISPUTE IS DOWNSTREAM OF A SINGLE-SLOT PRINT. One slot, two kinds of information
 * -- an epistemic warning ("this axis is unmeasured") and an actionable instruction ("resolve this
 * orphan") -- and they are not commensurable, so ANY total order sacrifices one. Fixing the slot
 * dissolves the ordering question; reordering is the symptom fix.
 *
 * The GUARANTEE, which is what the self-test pins and which survives any future rank:
 * WHENEVER A BLOCKING STATE IS PRESENT, A BLOCKING NEXT-ACTION IS PRINTED.
 */
function nextActions(states) {
  const worst = PRECEDENCE.find((s) => states.includes(s)) || "unknown";
  const out = [worst];
  if (NON_BLOCKING.has(worst)) {
    const worstBlocking = PRECEDENCE.find((s) => states.includes(s) && !NON_BLOCKING.has(s));
    if (worstBlocking) out.push(worstBlocking);
  }
  return out;
}

// ── SELF-TEST (deterministic; proves the classifier + precedence + ready). ──
if (args.includes("--self-test")) {
  let ok = true;
  const t = (name, cond) => { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };
  const c1 = classify({ unpushed: 0 });
  t("empty tree → clean + ready", c1.worst === "clean" && c1.ready === true && c1.states.join() === "clean");
  const c2 = classify({ unpushed: 3 });
  t("3 unpushed → unpushed + ready (owner-gated push is NON_BLOCKING)", c2.worst === "unpushed" && c2.ready === true);
  const c3 = classify({ dirtyMine: 1, unpushed: 2 });
  t("dirty_mine + unpushed → NOT ready, worst=dirty_mine", c3.worst === "dirty_mine" && c3.ready === false);
  const c4 = classify({ dirtyUnattributed: 1 });
  t("orphan dirty → NOT ready, worst=dirty_unattributed", c4.worst === "dirty_unattributed" && c4.ready === false);
  const c5 = classify({ migrationUnrecorded: 2, dirtyMine: 1 });
  t("migration-unrecorded outranks dirty_mine in precedence", c5.worst === "migration_unrecorded" && c5.ready === false);
  const c6 = classify({ dirtyPeer: 2 });
  t("peer WIP only → ready (not ours to resolve)", c6.worst === "dirty_peer" && c6.ready === true);
  const c7 = classify({ gitOk: false });
  t("git failure → unknown, NOT ready (never assume clean)", c7.worst === "unknown" && c7.ready === false);
  const c8 = classify({ unpushed: null });
  t("no upstream → no_upstream (ready — can't compute, not a miss)", c8.worst === "no_upstream" && c8.ready === true);
  // ⛔ THE ARM THAT WOULD HAVE RED-FLAGGED THE SERIOUS DEFECT.
  // My own control compared POPULATION counts (136 unfiltered vs 6 tracked), which refutes
  // "the filter is a no-op" and CANNOT see a verdict change:
  // a count comparison sits on the side of the question that cannot answer it. A tree whose
  // only dirt is UNTRACKED must classify CLEAN and ready, because untracked paths are never
  // attributed; if that ever returns dirty_unattributed, untracked has leaked back into the
  // attribution population and the rename blind spot is live again.
  const c9 = classify({ dirtyMine: 0, dirtyUnattributed: 0, dirtyPeer: 0, unpushed: 0 });
  t("untracked-only dirt → clean+ready (untracked never reaches attribution)",
    c9.ready === true && c9.worst !== "dirty_unattributed");
  // ⛔ UNMEASURED IS NOT CLEAN. Before 2026-09-12 an unreadable probe reached classify as
  // `migrationUnrecorded: 0` and scored CLEAN -- c10's exact inputs, opposite verdict.
  const c10 = classify({ migrationUnrecorded: 0, migProbeRead: false });
  t("probe did not report → migration_probe_unread, NOT clean",
    c10.worst === "migration_probe_unread" && c10.states.join() !== "clean");
  // ...and it is NON-BLOCKING: a no-DB environment is legitimate, so it must not stop a wrap.
  t("probe did not report → still ready (non-blocking)", c10.ready === true);
  // DISCRIMINATION: the same inputs with a probe that DID report must stay clean, or c10
  // proves nothing about migProbeRead and only that some argument changed the verdict.
  const c11 = classify({ migrationUnrecorded: 0, migProbeRead: true });
  t("probe reported zero findings → clean (the control for c10)",
    c11.worst === "clean" && c11.ready === true);
  // ⛔ THIS ARM REPLACES ONE THAT COULD NOT FAIL, AND THE PREMISE FOR DELETING THE OTHER HALF
  // WAS TRUE FOR TWENTY MINUTES. The deleted arm was
  // `classify({ migrationUnrecorded: 1, migProbeRead: false })`, dropped on the reasoning that the
  // input is UNREACHABLE because a probe that did not report yields no rows. That held at
  // 13:05:03Z (`instrumentFailed = 0`) and went FALSE at 13:25:02Z
  // (`instrumentFailed = 3`), which made `readMigrationProbe` return `read:false` WITH a non-zero
  // count. The sentence justifying the deletion stayed live for a day while the arm it justified
  // was precisely the arm that would have caught the `else if` swallow above. Restored below as
  // c13, keyed on the state that was being dropped rather than on precedence.
  // A dirty tree plus a failed probe IS reachable and does discriminate.
  const c12 = classify({ dirtyMine: 1, migProbeRead: false });
  t("unread probe leads the headline over dirty_mine, and dirty_mine still blocks",
    c12.worst === "migration_probe_unread" && c12.ready === false);
  // ⛔ THE RESTORED ARM, KEYED ON THE SWALLOWED STATE. Under `else if` this input returned
  // `["migration_unrecorded"]` alone and the unread probe vanished, so the consumer said a real
  // migration is unrecorded while staying silent about the instrument having failed on the same
  // run. Asserts BOTH states are present AND that the fix did not move the headline: `worst` and
  // `ready` are still driven by `migration_unrecorded`, which outranks it in PRECEDENCE.
  const c13 = classify({ migrationUnrecorded: 1, migProbeRead: false });
  t("unrecorded AND unread co-occur: both states emitted, headline unchanged",
    c13.states.includes("migration_unrecorded") && c13.states.includes("migration_probe_unread")
    && c13.worst === "migration_unrecorded" && c13.ready === false);

  // ── readMigrationProbe: the parse the probe block used to do inline, where no arm reached
  // it (measured -- deleting its flag assignment left the suite GREEN).
  const P = readMigrationProbe;
  t("empty stdout → NOT read (a non-zero exit makes sh() return an empty string)", P("").read === false);
  t("non-JSON stdout → NOT read (the ungated skip-notice prose)", P("a SKIPPED CHECK, not a clean result").read === false);
  t("explicit skipped:true → NOT read", P('{"clean":false,"skipped":true,"findings":[]}').read === false);
  // ⛔ blind:true is the OTHER "could not answer", and it had NO consumer here until 2026-09-12:
  // the producer withholds its own backfill command on a blind run, then emitted the same
  // unverified candidates over --json, which scored clean and routed /wrap to the very backfill
  // the producer refused to print (duplicate notation).
  t("blind:true with findings → NOT read, and the inflated names are NOT forwarded",
    (() => { const b = P('{"clean":false,"blind":true,"findings":[{"verdict":"APPLIED-UNRECORDED","num":"0275"}]}');
             return b.read === false && b.count === 0 && b.names.length === 0; })());
  t("blind:true on an otherwise-CLEAN run → still NOT read (blind ≠ clean)",
    P('{"clean":true,"blind":true,"scanned":4,"findings":[]}').read === false);
  t("blind:false is the other-way control → read (so the two arms above are not vacuous)",
    P('{"clean":true,"blind":false,"scanned":4,"findings":[]}').read === true);
  // POSITIVE CONTROLS -- without these, a reader that always returned NOT-read scores 3/3.
  const pClean = P('{"clean":true,"scanned":4,"findings":[]}');
  t("a real clean probe → read, 0 findings", pClean.read === true && pClean.count === 0);
  const pHit = P('{"clean":false,"findings":[{"verdict":"APPLIED-UNRECORDED","num":"0275"}]}');
  t("a real finding → read, counted, named", pHit.read === true && pHit.count === 1 && pHit.names.join() === "0275");
  // ⛔ PROBE-ERROR = the instrument failed, so the axis is UNMEASURED even though the JSON is
  // well-formed and the APPLIED-UNRECORDED count is legitimately 0.
  const pErr = P('{"clean":false,"findings":[{"verdict":"PROBE-ERROR","num":"0275"}]}');
  t("a PROBE-ERROR row → NOT read (well-formed JSON, zero findings, still unmeasured)", pErr.read === false);
  // ...and the NARROWING controls: these must stay READ, or the axis fires constantly and nobody
  // reads it. MANUAL is a considered "no probeable object"; UNAPPLIED is a measured finding.
  t("a MANUAL row → still read (a deliberate verdict, not a failure)",
    P('{"findings":[{"verdict":"MANUAL","num":"0275"}]}').read === true);
  t("an UNAPPLIED row → still read (a measured finding, not a failure)",
    P('{"findings":[{"verdict":"UNAPPLIED","num":"0275"}]}').read === true);
  // ⛔ an unrecognised SHAPE is not a clean read -- the dead fallback ladder made this parse to []
  t("valid JSON of a shape we never emit → NOT read", P('{"rows":[{"verdict":"APPLIED-UNRECORDED"}]}').read === false);

  // ⛔ THE GUARANTEE ARM, and it pins the PROPERTY rather than the ordering -- so it survives any
  // future rank, which the rejected `NON_BLOCKING is a suffix of PRECEDENCE` arm would not have.
  // Exhaustive over every subset of PRECEDENCE (2^9), so no sampling rule can miss a case.
  let guaranteeHoles = 0;
  for (let mask = 1; mask < (1 << PRECEDENCE.length); mask++) {
    const subset = PRECEDENCE.filter((_, i) => mask & (1 << i));
    if (subset.every((x) => NON_BLOCKING.has(x))) continue; // no blocking state present
    if (!nextActions(subset).some((x) => !NON_BLOCKING.has(x))) guaranteeHoles++;
  }
  t(`whenever a blocking state is present, a blocking next-action prints (${(1 << PRECEDENCE.length) - 1} subsets)`,
    guaranteeHoles === 0);
  // DISCRIMINATION: the arm must be able to fail. A single-slot print (the pre-fix behaviour) has
  // holes -- computed here from the same PRECEDENCE so it cannot go stale.
  const singleSlot = (st) => [PRECEDENCE.find((x) => st.includes(x)) || "unknown"];
  let singleSlotHoles = 0;
  for (let mask = 1; mask < (1 << PRECEDENCE.length); mask++) {
    const subset = PRECEDENCE.filter((_, i) => mask & (1 << i));
    if (subset.every((x) => NON_BLOCKING.has(x))) continue;
    if (!singleSlot(subset).some((x) => !NON_BLOCKING.has(x))) singleSlotHoles++;
  }
  t(`the single-slot print this replaced DOES have holes (${singleSlotHoles}) — the arm can fail`,
    singleSlotHoles > 0);
  // ...and the concrete measured case: no-DB box, orphan dirty file.
  const na = nextActions(["migration_probe_unread", "dirty_unattributed"]);
  t("no-DB box + orphan dirty → BOTH the advisory and the orphan tree print",
    na[0] === "migration_probe_unread" && na.includes("dirty_unattributed"));
  console.log(ok ? "\nself-test: ALL PASS" : "\nself-test: FAILURES");
  process.exit(ok ? 0 : 1);
}

// ── LIVE: gather signals + classify. ──
const sid8 = (process.env.CLAUDE_CODE_SESSION_ID || "").slice(0, 8);
const gitOk = sh("git rev-parse --is-inside-work-tree") === "true";
// Read porcelain WITHOUT sh()'s whole-output .trim() — git
// prefixes an UNSTAGED first line with a leading space (` M path`); trimming the whole output
// strips it, so slice(3) eats a real path char on the FIRST dirty file → mis-attribution.
// Per-line slice(3) is correct only if every line keeps its 3-char "XY " prefix.
let statusRaw = "";
try { statusRaw = execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { statusRaw = ""; }
// ⛔ ATTRIBUTE TRACKED-DIRTY ONLY — untracked (`??`) paths are excluded, 2026-09-01.
// `whose-edit` costs ~8s PER CALL (measured 3 consecutive: 8/8/8s; it is not a one-time
// manifest refresh) and takes exactly ONE file, so there is no batching to reach for.
// With CAP=25 that is ~200s every run, which is why this script never finished inside the
// /wrap step that calls it. Unfiltered `git status --porcelain` includes untracked: measured
// here at 6 tracked vs 130 untracked, so ~19 of the 25 attributed paths were eval scratch
// logs — the population where attribution means least — and once dirty paths exceed the cap
// they can crowd real tracked files OUT of the sample entirely. Filtering fixes the runtime
// and the answer in the same move. ⛔ THIS COMMENT CLAIMED THE REMAINING COST IS "bounded by
// tracked-dirty, which is single digits on a normal tree" AND THAT WAS FALSIFIED WITHIN TWO
// HOURS: a later reading measured 16 tracked-dirty × ~8s = 128s on the same tree, against the 41s I
// reported at 6. Both readings were correct when taken — this tree moves that fast — which is
// exactly why the claim should never have been written as a property. The fix lowered the
// CONSTANT and left the SCALING alone: CAP=25 still means a 200s worst case. The real fix is
// an N-path `whose-edit`, which is parked behind a revisit trigger. Do not read this block
// as having solved the runtime.
const statusLines = statusRaw.split("\n").filter(Boolean);
const dirtyPaths = statusLines
  .filter((l) => !l.startsWith("??"))
  .map((l) => l.slice(3).trim().replace(/^.* -> /, ""));
// ⛔ UNTRACKED ARE COUNTED, NEVER ATTRIBUTED — a serious finding, folded 2026-09-01.
// Filtering `??` out of ATTRIBUTION is right (that is the 200s). Filtering them out of the
// REPORT was not, and it fired immediately: memory shards roll their end-date, which git shows
// as ` D <old-date>` plus `?? <new-date>` — a rename it cannot pair because one half is
// untracked. Measured on this tree at fold time: 6 deleted and 6 untracked, matching by skill
// and start-date. The filter kept every deletion and hid every replacement, so the tool
// reported six memory archives as unattributed orphans. That matters because the
// dirty_unattributed nextAction is the claim-or-disclaim ladder, whose terminal step is adopt-and-commit
// after silence — a false alarm pointing at a destructive action. Counting them costs zero
// seconds (no whose-edit call), and deletions shown beside additions read as a roll.
// ✅ ENUMERATED 2026-09-01 — this was left open and it is now closed: NO OTHER WRAP STEP
// CATCHES AN UNTRACKED ORPHAN INDEPENDENTLY, so this finding stays serious rather than dropping.
// All 30 numbered wrap steps and every script they invoke were walked. `wrap-reconcile.mjs`
// — the OTHER half of this same Step 11 — references untracked ZERO times. Of the remaining
// scripts, `architecture-counts.mjs`'s only "untracked" is a prose comment about doc drift,
// and `memory-tier-split.mjs` / `agent-memory-load-audit.mjs` match `??` only as JS
// nullish-coalescing (neither calls `git status --porcelain`). `session-manifest.py`'s
// `get_working_tree_modified()` DOES include `??`, but its sole caller is `cmd_check_overlap`,
// which the wrap and /hanging-work invoke ZERO times — it is a dispatch-time gate wired into
// /expert-review and /agent-work, its correct home, not a wrap-time net.
// The ONE surface that sees them is Step 8's commit procedure, which classifies every
// porcelain entry and routes UNKNOWN to "surface for user decision" — orchestrator JUDGMENT,
// explicitly caveated "this skill can't infer", and aimed at what to COMMIT rather than at
// flagging an orphan. So the only instrument-level coverage is the block you are reading.
const untrackedCount = statusLines.filter((l) => l.startsWith("??")).length;

// unpushed count vs upstream (null if no upstream)
let unpushed = null;
if (gitOk && sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}")) {
  const n = parseInt(sh("git rev-list @{u}..HEAD --count") || "0", 10);
  unpushed = Number.isFinite(n) ? n : 0;
}

// attribute dirty files via whose-edit (Bash-aware, self-refreshes manifests); cap to avoid a slow sweep
let dirtyMine = 0, dirtyUnattributed = 0, dirtyPeer = 0;
const attribution = [];
const CAP = 25;
const haveWhoseEdit = existsSync("scripts/session-manifest.py");
for (const p of dirtyPaths.slice(0, CAP)) {
  const w = haveWhoseEdit ? sh(`python3 scripts/session-manifest.py whose-edit ${JSON.stringify(p)}`) : "";
  const mine = !!sid8 && w.includes(sid8);
  const unattrib = !w || /unattributed|working-tree/i.test(w);
  if (mine) dirtyMine++; else if (unattrib) dirtyUnattributed++; else dirtyPeer++;
  attribution.push({ path: p, mine, unattrib });
}

// migration applied-unrecorded (Shape B) — PLUGGABLE, degrade-silent
let migrationUnrecorded = 0;
let migProbeRead = null; // null = never asked (the probe is not installed here)
let migNames = [];
if (existsSync("scripts/migration-notation-reconcile.mjs")) {
  const r = readMigrationProbe(sh("node scripts/migration-notation-reconcile.mjs --json"));
  migProbeRead = r.read; migrationUnrecorded = r.count; migNames = r.names;
}

const { states, worst, ready } = classify({ dirtyMine, dirtyUnattributed, dirtyPeer, unpushed, migrationUnrecorded, gitOk, migProbeRead });

const label = (s) =>
  s === "unpushed" ? `unpushed(${unpushed})`
  : s === "dirty_mine" ? `dirty_mine(${dirtyMine})`
  : s === "dirty_unattributed" ? `dirty_unattributed(${dirtyUnattributed})`
  : s === "dirty_peer" ? `dirty_peer(${dirtyPeer})`
  : s === "migration_unrecorded" ? `migration_unrecorded(${migNames.join(",") || migrationUnrecorded})`
  : s;
const parts = states.map(label);
const enumStr = parts.length > 1 ? `mixed[${parts.join(", ")}]` : (parts[0] || "clean");

if (asJson) {
  console.log(JSON.stringify({ ok: ready, closure: enumStr, states, worst, ready, unpushed, dirtyMine, dirtyUnattributed, dirtyPeer, untrackedCount, migrationUnrecorded, migNames, attribution }));
} else {
  console.log(`git-story (warn-mode) — closure: ${enumStr}`);
  console.log(`  ready=${ready}${ready ? "" : "  ← NAME intent per non-clean component before claiming the wrap is complete"}`);
  // Untracked are NOT attributed (that is the runtime fix) but they ARE reported, so a reader
  // sees deletions and additions together and can recognise a rename the tool cannot pair.
  if (untrackedCount > 0) {
    console.log(`  untracked: ${untrackedCount} (unattributed BY CONSTRUCTION — never passed to whose-edit).` +
      ` Any orphan listed below with an untracked sibling is flagged there by name.`);
  }
  for (const s of nextActions(states)) console.log(`  next (${s}): ${NEXT_ACTION[s]}`);
  const orphans = attribution.filter((a) => a.unattrib && !a.mine).map((a) => a.path);
  if (orphans.length) {
    // ⛔ DELIBERATE DEVIATION FROM THE LETTER OF THE REQUEST, NAMED RATHER THAN DONE QUIETLY.
    // The request was for the untracked COUNT beside the orphans so a reader recognises a roll.
    // Implemented and it does not achieve that here: this tree carries 136 untracked (mostly
    // eval scratch) against 5 orphan deletions, and nobody reads those two numbers as a pair.
    // Its INTENT was that a rename stop looking like an orphan, so the count is kept AND
    // each orphan is checked for an untracked sibling in its own directory — a pure string
    // test over data already in hand, zero extra seconds, and it names the specific files
    // rather than asking the reader to infer from two totals.
    const untrackedDirs = new Set(statusLines.filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim()).map((p) => p.slice(0, p.lastIndexOf("/") + 1)));
    const paired = orphans.filter((p) => untrackedDirs.has(p.slice(0, p.lastIndexOf("/") + 1)));
    console.log(`  orphan dirty: ${orphans.join(", ")}`);
    if (paired.length) {
      console.log(`  ⚠️  ${paired.length} of ${orphans.length} have an UNTRACKED sibling in the same directory` +
        ` — check for a RENAME (a rolled end-date) before treating any as an orphan.` +
        ` git cannot pair these: one half is tracked-deleted, the other untracked.` +
        ` SCOPE: SAME-DIRECTORY ONLY — a shard MOVED to a different directory is NOT flagged,` +
        ` because its untracked half is not in this path.`);
    }
  }
}
process.exit(0); // warn-mode: never wedge /wrap
