#!/usr/bin/env node
// scripts/architecture-counts.mjs
// Single source-of-truth for architecture.md count claims.
//
// Usage:
//   node scripts/architecture-counts.mjs check         → report drifts to stderr, exit 1 if any
//   node scripts/architecture-counts.mjs list          → print current filesystem-derived counts (json)
//   node scripts/architecture-counts.mjs fix           → auto-fix doc claims for ≤5-LOC mechanical drifts
//
// Designed to be invoked from:
//   - scripts/skill-lint.mjs (ARCH_DOC_DRIFT detector — calls `check`)
//   - /wrap Step 7d (architecture-audit Tier 1 — calls `fix`)
//   - .githooks/pre-commit (warn-mode — calls `check`)
//
// Designed in the 2026-05-21 prevention stack ship (addresses the
// "55 drifts in 4 days" class found in a deep-dive audit of architecture.md).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const DOC_PATH = join(REPO_ROOT, ".claude/docs/architecture.md");
const COMPARISON_PATH = join(REPO_ROOT, ".claude/skills/meta/COMPARISON.md");

// --------------------------------------------------------------------------
// Filesystem-state computation — single source of truth for counts
// --------------------------------------------------------------------------

function sh(cmd) {
  // maxBuffer 64 MB: the `conceptual-due` path `git show <sha>:meta/MEMORY.md`s the
  // full ~4700-line lesson catalog, which blows execSync's ~1 MB default (ENOBUFS).
  // A larger cap never changes small-output behavior, so it's a safe global bump.
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

function shInt(cmd) {
  const out = sh(cmd);
  return parseInt(out, 10) || 0;
}

// Row count for the two-tier meta/RULES corpus (router + RULES-SHARD-*.md).
//
// ⛔ THE MANIFEST EXCLUSION IS SOUND ONLY WHILE THE SENTINEL IS UNIQUE, SO ASSERT THAT
// BEFORE TRUSTING THE NUMBER. The awk skips everything between BEGIN and END; it sets the
// flag on BEGIN and clears it only on END, so a SECOND BEGIN anywhere in the globbed corpus
// suppresses every row after it in that file. There is
// one mechanism that gets there: a shard that DOCUMENTS the split acquires the literal —
// most likely `## AH. Session procedure`, the section that forced the split in the first
// place. That is the self-instantiating-corpus class `bash-environment.md` already carries:
// writing the rule down plants a live instance in the corpus it globs.
//
// The failure DIRECTION is the safe one and that is worth stating, because the next reader's
// instinct is to worry about over-counting: an unpaired BEGIN can only ever REMOVE rows, so
// it under-counts against a known expectation and fails loud rather than drifting quietly.
// Measured 2026-09-04 with a BEGIN planted ABOVE shard 10's rows: **946 against a true 999**,
// exactly its 54 rows less the separator. ⚠️ The FIRST attempt at that mutation appended the
// literal at end-of-file, where no rows follow it, and read a clean 999 — a mutation outside
// the predicate's field of view, which proves nothing in either direction. Place a mutation
// where the thing it should break actually lives before believing its result.
// This assertion converts "unlikely collision" into "cannot happen silently".
//
// The sentinel is NAMESPACED, which is what makes it sound today — bare "BEGIN"/"END" appear
// in all ten shards; the full `RULES-SPLIT:MANIFEST-` literal appears once each, in the
// router only. `|| true` is on the greps because `grep -c` exits 1 on zero
// matches and execSync throws; the GATE is the JS comparison below, not the shell.
function metaRulesRowCount() {
  const GLOB = ".claude/skills/meta/RULES*.md";
  const n = (tok) => shInt(`cat ${GLOB} 2>/dev/null | grep -c '${tok}' || true`);
  const nBegin = n("RULES-SPLIT:MANIFEST-BEGIN");
  const nEnd = n("RULES-SPLIT:MANIFEST-END");
  // no meta/RULES*.md at all (a project that keeps no rules catalog): no rows, like every other count
  // here when its files are absent; the throw below is for a catalog that exists with a broken sentinel
  if (nBegin === 0 && nEnd === 0 && shInt(`ls ${GLOB} 2>/dev/null | wc -l`) === 0) return 0;
  if (nBegin !== 1 || nEnd !== 1) {
    throw new Error(
      `metaRulesRows: manifest sentinel is not unique across ${GLOB} ` +
        `(BEGIN=${nBegin}, END=${nEnd}; expected 1 and 1). The row count excludes everything ` +
        `between them, so a duplicate BEGIN silently drops every row after it — an UNDER-count. ` +
        `Likeliest cause: a shard now documents the split and contains the literal. Fix by moving ` +
        `that prose to the router, or rename the sentinel in BOTH scripts/rules-tier-split.mjs ` +
        `and here, then re-run the splitter.`
    );
  }
  return shInt(
    `awk '/RULES-SPLIT:MANIFEST-BEGIN/{m=1} /RULES-SPLIT:MANIFEST-END/{m=0;next} m{next} /^\\| /{p++} /^\\|-/{s++} END{print p-s}' ${GLOB}`
  );
}

function computeCounts() {
  // metaEntryPoints is the single source for both the entry-point claim and the
  // derived subcommand claim (entry points = bare `/meta` + N subcommands, so
  // subcommands = entryPoints - 1). Computed once to avoid a double file read.
  const metaEntryPoints = countMetaEntryPoints();
  return {
    skills: shInt("ls -d .claude/skills/*/ 2>/dev/null | wc -l"),
    agents: shInt("ls .claude/agents/*.md 2>/dev/null | wc -l"),
    hooks: shInt("ls .claude/hooks/*.sh .claude/hooks/*.py 2>/dev/null | wc -l"),  // .py since 2026-10-14: three wired Python hooks were invisible to this count
    // settings.json-wired hook sub-count — a secondary breakdown the doc states in 2 places
    // (Lecture 11 "N wired in settings.json" + the Appendix-B "wired in settings.json, N"
    // sub-heading); drifted 25/27→29 silently before this count existed (2026-06-23 audit).
    hooksWiredSettings: shInt("grep -oE '\\.claude/hooks/[a-zA-Z0-9._-]+\\.(sh|py)' .claude/settings.json 2>/dev/null | sort -u | wc -l"),
    rules: shInt("ls .claude/rules/*.md 2>/dev/null | wc -l"),
    commands: shInt("ls .claude/commands/*.md 2>/dev/null | wc -l"),
    templates: shInt("ls .claude/templates/* 2>/dev/null | wc -l"),
    projectMemory: shInt("ls .claude/project-memory/*.md 2>/dev/null | wc -l"),
    externalSkills: shInt("ls -d .claude/skills/external-*/ 2>/dev/null | wc -l"),
    domainExperts: shInt("ls -d .claude/skills/*-expert/ 2>/dev/null | wc -l"),
    personaSkills: shInt("ls -d .claude/skills/*-persona/ 2>/dev/null | wc -l"),
    // TIER UNION (2026-08-06, the meta archive split). MEMORY.md is now a ~26 KB ROUTER; the
    // ledger lives across MEMORY-ARCHIVE-*.md shards beside it. Reading the router alone reports
    // ~105 — a real number that MEANS NOTHING about the system, and the architecture doc quotes
    // this as "N lines of meta MEMORY". Summing `MEMORY*.md` keeps the metric measuring what its
    // consumers think it measures. `cat` over the glob, so a new shard is counted the day it rolls.
    metaMemoryLines: shInt("cat .claude/skills/meta/MEMORY*.md | wc -l"),
    // metric-truth fix 2026-06-22: TRUE data rows = pipe-space lines (header+data) − section separators (= the 25 section headers, 1:1); counts RULES, not table structure
    // ⛔ GLOB THE SHARDS, AND SKIP THE ROUTER'S MANIFEST BLOCK. RULES.md became a ROUTER on
    // 2026-09-04 (scripts/rules-tier-split.mjs) and the rows moved to RULES-SHARD-*.md, so the
    // old `RULES.md`-only form reads the MANIFEST instead of the rules: measured 51 against a
    // true 999 — a 95% undercount, silent, feeding every doc this SSOT checks. The manifest
    // rows are excluded by sentinel rather than by count so adding a shard cannot skew it.
    // Verified count-preserving across the split: 999 before, 999 after.
    metaRulesRows: metaRulesRowCount(),
    maxL: extractMaxL(),
    distinctLessons: countDistinctLessons(),
    sniffTestTriggers: countSniffTestTriggers(),
    // = the always-loaded Band-U Hot-Tier rows in active-recall.md. This is NOT the whole Hot
    // Tier: the orchestrator-only Band-O rows moved to .claude/orchestrator/ in the 2026-07-12
    // 2-band split and are counted separately as activeRecallBandO. Each count maps 1:1 to a
    // file (see REGEX_DERIVED), so this stays bound to active-recall.md rather than a cross-file sum.
    activeRecallHotTier: countActiveRecallHotTier(),
    // Band-O = the hook-delivered orchestrator-only Hot-Tier rows (band-o-inject.sh, UserPromptSubmit;
    // NOT always-loaded → deliberately absent from the check-band-budget always-loaded band). Added
    // 2026-07-12 to close the Band-O blindness the split created.
    activeRecallBandO: countActiveRecallBandO(),
    // Meta-skill internal procedure-step counts (added 2026-06-06). These are
    // spec-internal counts, not filesystem object counts — the class the script
    // was previously blind to (4 of 5 drifts measured 2026-06-06
    // were here: self-audit "9 checks" stale at 10, "9 subcommands" stale at 10).
    selfAuditChecks: countSelfAuditChecks(),
    // session-manifest.py subcommand count — the doc's "N modes" claim sat spelled-out
    // ("Seven modes") and untracked while the real set grew to 18 (2026-08-02 audit).
    // Derived from the argparse registrations; `sub.`-anchored so the docstring's bare
    // `add_parser()` mention never counts.
    sessionManifestModes: shInt("grep -c 'sub\\.add_parser(' scripts/session-manifest.py"),
    metaEntryPoints,
    metaSubcommands: Math.max(0, metaEntryPoints - 1),
  };
}

function countSelfAuditChecks() {
  // Ground truth = the ENUMERATED numbered checks in the "Process — Self Audit" section,
  // NOT the hand-maintained "**Checks (N):**" header. Reading that header as the SSOT is what
  // let a stale "(11)" (after Check 12 shipped) make the header + this count + architecture.md
  // ALL agree on the wrong number — a detector that reads its own target is a mirror, not a
  // check. The header's own correctness is /meta self-audit Check 1's job (embedded-number drift).
  try {
    const path = ".claude/skills/meta/SKILL.md";
    if (!existsSync(path)) return 0;
    const txt = readFileSync(path, "utf-8");
    const start = txt.indexOf("## Process — Self Audit");
    const end = txt.indexOf("## Process — Status");
    if (start === -1 || end === -1 || end <= start) return 0;
    return (txt.slice(start, end).match(/^\d+\.\s+\*\*/gm) || []).length; // \s+ = whitespace-tolerant (a future "10.  **" / tab won't mis-count)
  } catch {
    return 0;
  }
}

function countMetaEntryPoints() {
  // Source of truth: meta/SKILL.md "### Primary entry points (N — memorize these)".
  // Counts the bare `/meta` full-review entry PLUS every subcommand.
  try {
    const path = ".claude/skills/meta/SKILL.md";
    if (!existsSync(path)) return 0;
    const m = readFileSync(path, "utf-8").match(/Primary entry points\s+\((\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

function countDistinctLessons() {
  // Count distinct numbered lessons in meta/MEMORY.md. Up to 4 digits: real
  // lessons crossed four digits in 2026-07 (maxL 1026 at the 2026-08-02 audit), so the
  // old {1,3} cap excluded genuine lessons. The cap's stated rationale — filter
  // file:line false-positives — was overstated: a bare `schema.ts:1319` ref never
  // matches (`\bL` needs a literal L prefix), but GitHub-permalink style `file.md:L<n>`
  // DOES carry it (measured 2026-08-02: 2 such refs in meta/MEMORY.md, both `:L<n>`
  // anchors — pre-existing at {1,3}, ~0.2% inflation of the distinct count; worth
  // knowing only if this number is ever quoted to a decimal).
  // TIER UNION (2026-08-06, the meta archive split) — the bodies moved to MEMORY-ARCHIVE-*.md
  // shards; reading the router alone would report the handful of L# its digest rows happen to
  // name and call that "distinct lessons".
  try {
    const content = readMetaMemoryTiers();
    if (!content) return 0;
    const matches = content.match(/\bL\d{1,4}\b/g) || [];
    return new Set(matches.map((m) => m.substring(1))).size;
  } catch {
    return 0;
  }
}

/**
 * Concatenate every meta memory tier (`MEMORY.md` + any `MEMORY-ARCHIVE-*.md`) in filename order.
 * Mirrors `memoryTierPaths()` in check-lesson-numbers.mjs — same glob, same reason: after the
 * 2026-08-06 split, ANY single-file read of the ledger under-reports silently. Returns "" when the
 * dir is unreadable so callers keep their existing fail-to-0 behaviour.
 */
// The meta memory tier — ONE predicate, used by the live reader AND the historical reader. It was
// two textually-identical literals twenty lines apart with the invariant stated only in prose, and
// that predicate has a measured history of being deliberately widened away elsewhere
// (`scripts/memory-config-drift.mjs`, 2026-09-09). One constant makes the two readers structurally
// identical instead of hopefully identical: if the live max and the prior max ever select different
// files, the delta measures two different corpora and reads as growth.
const MEMORY_TIER_RE = /^MEMORY.*\.md$/;
const META_TIER_DIR = ".claude/skills/meta/";

function readMetaMemoryTiers() {
  const dir = join(REPO_ROOT, META_TIER_DIR);
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => MEMORY_TIER_RE.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf-8"))
    .join("\n");
}

// Git accessors for the historical read, at MODULE scope so `--self-test` can pin them.
//
// ⛔ THE ORIGINAL DEFECT LIVED IN THE GIT-STRING CONSTRUCTION, SO THAT IS WHAT MUST BE TESTABLE.
// These were inline lambdas at the call site until review: the
// dependency-injection seam made the pure filter/sort/join testable and left the impure half —
// the verb, the path, the flags — untested, which is the half the router-only bug was in. Two
// parts of the ls-tree command are load-bearing AND invisible, and each one alone darkens the gate
// again with every other arm green:
//   - `:(top)` — an ls-tree pathspec resolves against CWD (the old `git show <rev>:<path>` form
//     did not), so run from `scripts/` the bare path lists 0 files. `sh()` passes no `cwd`.
//   - the TRAILING SLASH — without it ls-tree lists the directory ENTRY itself (1 line, basename
//     `meta`) instead of its children (61 lines at 2026-09-14).
// The command builders are pure strings; the self-test asserts both parts are present.
function lsTreeMetaCmd(sha) {
  return `git ls-tree --name-only ${sha} ':(top)${META_TIER_DIR}'`;
}
function showMetaCmd(sha, name) {
  return `git show ${sha}:${META_TIER_DIR}${name}`;
}
function parseLsTreeNames(stdout) {
  return stdout.split("\n").filter(Boolean).map((p) => p.split("/").pop());
}

// Prior-max-L at a historical ref, for `conceptual-due`'s lessons delta.
//
// ⛔ THIS READ `MEMORY.md` ALONE UNTIL 2026-09-14, AND THE LESSONS HALF OF THE GATE HAD BEEN
// DARK FOR EVERY RUN WHOSE `last-reviewed` ANCHOR FELL AFTER THE 2026-08-06 ARCHIVE SPLIT. The
// dark window is a property of the ANCHOR, not of the calendar: the router read returns 0 at the
// first post-split ref and every one after. `extractMaxL` was given the tier union at that split
// with a comment carving this path out — "those SHAs predate the split" — which was TRUE when
// written and expired silently the moment the anchor moved past it. A carve-out justified by a
// date is a time bomb; the union is now read on BOTH paths.
//
// Returns `{ max, cause }`. `cause` is a CODE naming which early return fired, never prose, so the
// caller can classify it — see `classifyLessonsGate`. Four null causes exist and they are not the
// same fact: an operator must be told which one happened, not handed one guess for all four.
function priorMaxLAt(sha, lsTree, show) {
  if (!sha) return { max: null, cause: "no-sha" };
  const names = lsTree(sha).filter((f) => MEMORY_TIER_RE.test(f)).sort();
  if (!names.length) return { max: null, cause: "no-files" };
  const text = names.map((n) => show(sha, n)).join("\n");
  if (!text.trim()) return { max: null, cause: "blank-read" };
  const max = maxLFromText(text);
  if (max <= 0) return { max: null, cause: "no-header" };
  return { max, cause: null };
}

// Classify the lessons half of `conceptual-due` as MEASURED, EMPTY or DARK.
//
// ⛔ THE QUESTION THIS EXISTS TO ANSWER, from review: the old bug and every new failure path
// printed the same PARTIAL, so nothing told an operator a DARK gate from a healthy one with nothing
// to compare — and PARTIAL is exactly the output that sat unnoticed for three weeks. So:
//   EMPTY — a legitimate absence of anything to compare. Reported as PARTIAL.
//   DARK  — the INSTRUMENT failed. Reported as its own loud verdict, never as PARTIAL, never as ✅.
//
// ⛔ AND THE FIRST FIX CREATED A PATH WHERE DARK PRINTED ✅. `extractMaxL` returns 0 on any throw;
// once the prior max became a real number at every ref, `0 − 1823 = −1823` failed the `>= 30`
// threshold and fell through to "conceptual pass OK". So a live max BELOW the prior is DARK, never a
// delta — and ⛔ NOT because a falling max is impossible. It is possible: the NEWEST lesson can leave
// the tier — a revert of the commit that minted it, a tier file renamed outside `MEMORY_TIER_RE`, or
// the retirement sweep moving it out of the tier — and the max falls legitimately. Only a WITHDRAWN
// mark can send the newest lesson to the sweep: a SUPERSEDED / REFUTED mark is written by a LATER
// lesson (`/meta learn` Step 2c), so the lesson it retires is never the max. The
// reason is that a delta across a falling max compares two different corpora, so whatever caused it —
// a lesson leaving the tier or a bad read — the honest reading is "these two refs cannot be compared".
// (Review first prescribed this check as "impossible in an append-only ledger"; a later demote path, since
// removed, refuted that reason and kept the behaviour. Do not re-derive "impossible" — the reason
// string names the tier-leaving causes before the read failure, and self-test G2b pins that order.)
//
// `headTierCount` is a LIVENESS CANARY: the number of meta-memory files git lists at HEAD. A healthy
// repo always has them, so a zero there is unambiguously the instrument (git failing, or the
// accessor broken) rather than the history. It is also what lets `no-files` at a prior ref be read
// as EMPTY — the meta dir genuinely did not exist before 2026-04-14 — only once git is proven able
// to list. Without it, a broken git reported "no commit found" or "no files", both of them false.
//
// `gitDark` rides on EVERY verdict because a failing git darkens more than the lessons half: the
// new-infra count and the meta-commit count are `git log` reads too, and under a broken git they
// come back 0 — a clean-looking "0 new infra file(s)" that is the instrument, not the history.
// Measured with GIT_DIR pointed at nothing: before this field the output said "infra below
// threshold" over a zero git never computed.
function classifyLessonsGate(prior, liveMax, headTierCount) {
  const gitDark = !(headTierCount > 0);
  const dark = (why) => ({ delta: null, dark: true, gitDark, why });
  const empty = (why) => ({ delta: null, dark: false, gitDark, why });
  if (!(liveMax > 0)) {
    return dark("the LIVE max-L read 0 — extractMaxL failed to read the meta tier on disk");
  }
  if (gitDark) {
    return dark("git lists no meta-memory file even at HEAD — git itself is failing, so no history read was made");
  }
  switch (prior.cause) {
    case "no-sha":
      return empty("no commit found at or before last-reviewed");
    case "no-files":
      return empty("the meta-memory directory did not exist yet at the prior ref");
    case "blank-read":
      return dark("meta-memory files are listed at the prior ref but every one read back empty — git show is failing");
    case "no-header":
      return dark("meta-memory files were read at the prior ref but no lesson header matched — the lesson parser is out of step with the format");
    default:
      break;
  }
  if (liveMax < prior.max) {
    return dark(`live max-L L${liveMax} is BELOW the prior ref's L${prior.max}, so the two refs are not counting the same corpus — the newest lesson has left the tier since (a revert of the commit that minted it, a tier file renamed outside MEMORY_TIER_RE, or a WITHDRAWN mark on that lesson taken out of the tier by the retirement sweep — a SUPERSEDED or REFUTED mark retires an older lesson and cannot lower the max); otherwise one of the two reads is wrong`);
  }
  return { delta: liveMax - prior.max, dark: false, gitDark, why: null };
}

function maxLFromText(content) {
  // Max real-lesson L#. Three definition forms (the prior version counted only the
  // first two — dated headers + L-named bullets — and so MISSED bare-bullet lessons
  // that exceed the header-max, e.g. two from a 2026-06-06 collision-renumber:
  // it read 390 while the true max was 392). Bare-bullet lessons ARE counted here;
  // sub-list ordinals (`1.`, `2.` inside a lesson body) are always small so they can
  // never win a MAX — no monotonic gate needed for a max-only computation. Bounds
  // (corrected 2026-08-01 at the three-to-four-digit rollover, which the old blanket 999-cap
  // silently ate — maxL read 999 with the first four-digit lessons live, so the next mint would have
  // collided): explicit `L<n>` forms (a)/(b) accept up to 9999; the LEGACY bare-bullet
  // form (c) keeps the 999 cap, because that pattern is what a stray year-number
  // bullet ("2026. **…") could match, and no legacy lesson exceeds ~392.
  // (cap fix 2026-06-06; rollover fix 2026-08-01.)
  let max = 0;
  const consider = (n) => { if (n >= 1 && n <= 9999 && n > max) max = n; };
  const considerLegacy = (n) => { if (n >= 1 && n <= 999 && n > max) max = n; };
  // (a) dated section headers: `## [YYYY-MM-DD — ]L<N>: …`. Date separator accepts
  // em-dash / en-dash / ASCII hyphen — the same three shapes check-lesson-numbers.mjs
  // was hardened for (its 2026-07-10 header: `- L<n>:` + `– L<n>:` EVADED a colon-only
  // regex). An em-dash-only maxL under-reads on those headings → the next mint takes a
  // taken number → manufactures the exact collision the push-gate then rejects.
  for (const m of content.matchAll(/^## (?:\d{4}-\d{2}-\d{2} [—–-] )?L(\d+)\b/gm)) consider(parseInt(m[1], 10));
  // (b) L-named numbered bullets: `<N>. **L<M>…`
  for (const m of content.matchAll(/^\d+\.\s+\*\*L(\d+)\b/gm)) consider(parseInt(m[1], 10));
  // (c) bare numbered-bullet lessons: `<N>. **title…` (the earliest lessons' legacy form + renumber landings)
  for (const m of content.matchAll(/^(\d+)\.\s+\*\*/gm)) considerLegacy(parseInt(m[1], 10));
  return max;
}

function extractMaxL() {
  // Reads the live meta/MEMORY.md. `maxLFromText` is factored out so the
  // `conceptual-due` path can reuse the EXACT same logic on a HISTORICAL
  // `git show <sha>:…` snapshot (computing the max-L delta since last-reviewed)
  // — no re-implementation drift between current-max and prior-max.
  // TIER UNION (2026-08-06, the meta archive split). MEASURED at the split: reading the router
  // alone returned maxL **0** — the highest declaration now lives in the newest ARCHIVE shard, and
  // a 0 here is not a visible breakage, it silently tells `lesson-mint` and the COMPARISON banner
  // that the ledger is empty. The historical path (`priorMaxLAt`) reads the SAME tier union at the
  // prior ref, via the same `MEMORY_TIER_RE`.
  // ⛔ THIS SAID "the historical path uses a single snapshot, which is correct: those SHAs predate
  // the split" UNTIL 2026-09-14. It was the carve-out that darkened `conceptual-due`'s lessons gate
  // for every run anchored after 2026-08-06 — true when written, false the day the anchor moved.
  // Never justify reading less than the union by a date; dates move and the comment does not.
  try {
    const content = readMetaMemoryTiers();
    if (!content) return 0;
    return maxLFromText(content);
  } catch {
    return 0;
  }
}

function countSniffTestTriggers() {
  try {
    const path = ".claude/skills/sniff-test/SKILL.md";
    if (!existsSync(path)) return 0;
    const body = readFileSync(path, "utf-8");
    // Count trigger conditions: lines like "1. **Draft length**" ... "8. **Defer-vague-language**"
    // Look for the Trigger conditions section
    const sectionMatch = body.match(/## Trigger conditions[\s\S]*?(?=\n## )/);
    if (!sectionMatch) return 0;
    return (sectionMatch[0].match(/^\d+\.\s+\*\*/gm) || []).length;
  } catch {
    return 0;
  }
}

function countActiveRecallHotTier() {
  try {
    const path = ".claude/rules/active-recall.md";
    if (!existsSync(path)) return 0;
    const body = readFileSync(path, "utf-8");
    // Hot Tier section table rows
    const sectionMatch = body.match(/## Hot Tier[\s\S]*?(?=\n## )/);
    if (!sectionMatch) return 0;
    const rows = sectionMatch[0].match(/^\|.+\|.+\|.+\|$/gm) || [];
    // Subtract header + separator rows
    return Math.max(0, rows.length - 2);
  } catch {
    return 0;
  }
}

// The hook-delivered ORCHESTRATOR band (Band-O) of the active-recall Hot Tier, added by the
// 2026-07-12 2-band split. Parallel to countActiveRecallHotTier: it counts ONLY the
// "## Orchestrator Hot Tier" section (the "## User pushback handling" sub-table is separate,
// exactly as the Band-U counter ignores the Operational / Recommend sub-tables). Closes the
// instrument's Band-O blindness — every scanner of active-recall.md silently lost these rows
// when they moved out (firerate had the identical gap, fixed peer-side).
function countActiveRecallBandO() {
  try {
    const path = ".claude/orchestrator/active-recall-orchestrator.md";
    if (!existsSync(path)) return 0;
    const body = readFileSync(path, "utf-8");
    const sectionMatch = body.match(/## Orchestrator Hot Tier[\s\S]*?(?=\n## )/);
    if (!sectionMatch) return 0;
    const rows = sectionMatch[0].match(/^\|.+\|.+\|.+\|$/gm) || [];
    return Math.max(0, rows.length - 2);
  } catch {
    return 0;
  }
}

// --------------------------------------------------------------------------
// Drift detection — parse architecture.md claims, compare against filesystem
// --------------------------------------------------------------------------

// Each PATTERN is a tuple of [regex, count-key, label, options?].
// Regex MUST have the number as capture-group 1.
// Patterns are precision-tuned to avoid false-positives on arbitrary numbers.
// Optional 4th field `options.tolerance` — allowed absolute drift before flagging.
// Defaults to 0 (exact match). Use tolerance > 0 for approximate prose claims
// (e.g., `~1680 lines` near a file that grows daily).
// Number-word support — some doc claims spell the count ("The eleven primary
// entry points") rather than using a digit. parseCount normalizes either form
// for comparison; matchedReplacement renders the fix in the SAME form the doc
// used (word→word, digit→digit) so auto-fix never turns prose "eleven" into "11".
// Covers 0–20; counts above 20 fall back to digit form on replacement.
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];
const WORD_TO_NUM = Object.fromEntries(NUMBER_WORDS.map((w, i) => [w, i]));

function parseCount(token) {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  const w = token.toLowerCase();
  return Object.prototype.hasOwnProperty.call(WORD_TO_NUM, w) ? WORD_TO_NUM[w] : NaN;
}

function matchedReplacement(token, actual) {
  if (/^\d+$/.test(token)) return String(actual);
  const word = NUMBER_WORDS[actual] ?? String(actual);
  return /^[A-Z]/.test(token) ? word[0].toUpperCase() + word.slice(1) : word;
}

const PATTERNS = [
  // === Structural counts (exact match) ===
  // Skills
  [/\b(\d+)\s+skill\s+director(?:y|ies)\b/gi, "skills", "skill directories"],
  [/\b(\d+)\s+skill\s+specifications\b/gi, "skills", "skill specifications"],
  // Appendix B snapshot phrasing — the canonical exact-count home now that Preface prose is approximate.
  [/\bSkills\s+\((\d+)\s+director/gi, "skills", "Appendix B snapshot: Skills (N directories)"],
  // Preface bullet: a bold "N skills" followed by the skills directory path in backticks — the agents twin below existed, this one did not, so `check` read CLEAN over a stale Preface figure.
  // ⛔ Both path legs END at the closing paren. Without the terminator a bold-N bullet naming a SUBSET of the directory scores against the TOTAL, and `fix` (wired into /wrap Step 7d) would rewrite a correct subset count. The agents twin was safe only because that directory happens to be flat; a copied pattern inherits the shape, not the precondition. Arms B1-B4 in --self-test.
  [/\*\*(\d+)\s+skills?\*\*\s+\(\s*[`'"]?\.claude\/skills\/(?:\*\/)?[`'"]?\s*\)/gi, "skills", "skills (in .claude/skills/)"],
  // Agents
  [/\*\*(\d+)\s+agents?\*\*\s+\(\s*[`'"]?\.claude\/agents\/(?:\*\/)?[`'"]?\s*\)/gi, "agents", "agents (in .claude/agents/)"],
  [/(\d+)\s+agents?\s+in\s+`?\.claude\/agents/gi, "agents", "agents in .claude/agents/"],
  [/\bAgents\s+\((\d+)\s+files?\)/gi, "agents", "Appendix B snapshot: Agents (N files)"],
  // Hooks
  [/\*\*(\d+)\s+hooks?\*\*\s+\(`?\.claude\/hooks/gi, "hooks", "hooks in .claude/hooks/"],
  [/\*\*(\d+)\s+hook\s+scripts?\*\*\s+in\s+`?\.claude\/hooks/gi, "hooks", "hook scripts in .claude/hooks/"],
  [/(?:^|\s)(\d+)\s+hooks?\s+we\s+ship\b/gi, "hooks", "hooks we ship"],
  [/(?:we\s+ship|ships?)\s+(\d+)\s+hook\s+scripts?/gi, "hooks", "we ship N hook scripts"],
  [/Mapping\s+the\s+(\d+)\s+hooks?\b/gi, "hooks", "Mapping the N hooks"],
  [/The\s+(\d+)\s+are\s+the\s+`?\.claude\/hooks/gi, "hooks", "The N are the .claude/hooks/*.sh scripts"],
  [/`\*\.sh`\s+count\s+of\s+(\d+)/gi, "hooks", "the `*.sh` count of N"],
  [/Hooks?\s+\((\d+)\s+files?\):/gi, "hooks", "Hooks (N files):"],
  // Total-hooks parenthetical "(31; `.claude/hooks/*.sh`)" — the Preface phrasing the
  // bold / "we ship" patterns above miss (2026-06-23 audit caught it by manual inspection).
  [/\((\d+);\s*`?\.claude\/hooks/gi, "hooks", "(N; .claude/hooks/*.sh) parenthetical"],
  // settings.json-wired sub-count, both phrasings (number-before "wired" + number-after
  // "settings.json,"). Drifted 25/27→29 silently; the two patterns are mutually exclusive
  // (one requires a digit before "wired", the other a digit after "settings.json,").
  [/(\d+)\s+wired\s+in\s+`?(?:\.claude\/)?settings\.json/gi, "hooksWiredSettings", "N wired in settings.json"],
  [/wired\s+in\s+`?\.claude\/settings\.json`?,\s*(\d+)/gi, "hooksWiredSettings", "wired in .claude/settings.json, N"],
  // Rules
  [/\*\*(\d+)\s+rule\s+files?\*\*/gi, "rules", "rule files"],
  [/Rules?\s+\((\d+)\s+files?\):/gi, "rules", "Rules (N files):"],
  [/The\s+(\d+)\s+rule\s+files?\b/gi, "rules", "The N rule files (heading)"],
  // Commands
  [/\*\*(\d+)\s+slash\s+commands?\*\*/gi, "commands", "slash commands"],
  [/Commands?\s+\((\d+)\s+files?\):/gi, "commands", "Commands (N files):"],
  // Templates
  [/\*\*(\d+)\s+templates?\*\*/gi, "templates", "templates"],
  [/Templates?\s+\((\d+)\s+files?\):/gi, "templates", "Templates (N files):"],
  // Project memory
  [/\*\*(\d+)\s+project-memory\s+files?\*\*/gi, "projectMemory", "project-memory files"],
  // External skills
  [/\*\*(\d+)\s+catalogued\s+external\s+systems?\*\*/gi, "externalSkills", "catalogued external systems"],
  [/(\d+)\s+catalogued\s+external\s+systems?/gi, "externalSkills", "catalogued external systems (inline)"],
  [/\bexternal-\*\/`?\s*\((\d+)\s+director/gi, "externalSkills", "external-*/ (N directories)"], // `?: the doc spells the path in backticks; the bare form read 0 and left an 8 standing against 10
  // Domain experts (file index)
  [/<domain>-expert\/.*?\((\d+)\s+director/gi, "domainExperts", "<domain>-expert/ (N directories)"],
  // Persona skills
  [/<\.\.\.>-persona\/.*?\((\d+)\s+director/gi, "personaSkills", "<...>-persona/ (N directories)"],
  // Sniff-test triggers
  [/sniff-test[^.]*?\((\d+)\s+(?:auto-fire\s+)?triggers?\)/gi, "sniffTestTriggers", "sniff-test (N triggers)"],
  [/ANY\s+of\s+(\d+)\s+trigger\s+condition/gi, "sniffTestTriggers", "ANY of N trigger conditions"],
  [/ANY\s+of\s+(\d+)\s+triggers?\s+match/gi, "sniffTestTriggers", "ANY of N triggers match"],
  // Active-recall Hot Tier
  [/top.*?(\d+).*?hot\s+tier/gi, "activeRecallHotTier", "top N hot tier"],
  [/hot\s+tier\s+is\s+the\s+top\s+(\d+)/gi, "activeRecallHotTier", "hot tier is the top N"],

  // === Narrative claims (approximate match, tolerance > 0) ===
  // Catches the drift class manually surfaced in 2026-05-23 chapter audit:
  // "286 numbered lessons" / "L1–L<max>" / "~1540 lines" / "top-25 most-cited" / "308 rows".

  // Lesson count phrasings — tolerance ±10. Requires `in` / `(` / `with` follow-up
  // to distinguish count claims ("286 numbered lessons in meta/MEMORY.md") from
  // threshold expressions ("advances by ≥10 numbered lessons"). The `\*{0,2}`
  // between `lessons` and the follow-up token handles markdown bold delimiters
  // (`**286 numbered lessons** in` is a common Preface-bullet shape).
  // Follow-up token set includes `,` (no \b — comma is non-word): the doc's own
  // Preface shape is "~N distinct lessons, L1–L<max> with renumber gaps", which the
  // in|(|with set missed TWICE (2026-07-16 + 2026-07-19) while skill-lint caught it.
  [/~?(\d+)\s+numbered\s+lessons?\*{0,2}\s*(?:(?:in|with)\b|\(|,)/gi, "distinctLessons", "N numbered lessons (count claim)", { tolerance: 10 }],
  [/~?(\d+)\s+distinct\s+(?:numbered\s+)?lessons?\*{0,2}\s*(?:(?:in|with)\b|\(|,)/gi, "distinctLessons", "N distinct lessons (count claim)", { tolerance: 10 }],
  [/~?(\d+)\s+distinct\s+entries\b/gi, "distinctLessons", "N distinct entries (lessons)", { tolerance: 10 }],
  // "lessons list ... ~N entries" — anchored to "lessons list" so we don't
  // false-positive on every "N entries" in the doc (Appendix B file-index uses
  // "entries" in different contexts).
  [/lessons list[\s\S]{0,150}?~?(\d+)\s+entries/gi, "distinctLessons", "lessons list N entries", { tolerance: 10 }],

  // L# range phrasings — exact match against max L#. STRICT: requires topic-tag
  // parens on either L1 or the ending L<N>, OR "with renumber gaps" tail.
  // Without these anchors a match is likely a teaching example ("L1-L247") not a claim.
  [/\bL1\s*\([^)]+\)\s*(?:[–—\-]|through)\s*L(\d+)/gi, "maxL", "L1 (tag) – LN range"],
  [/\bL1\b\s*(?:[–—\-]|through)\s*L(\d+)\s*\([^)]+\)/gi, "maxL", "L1 – LN (tag) range"],
  [/\bL1\b\s*(?:[–—\-]|through)\s*L(\d+)\s+with\s+renumber\s+gaps/gi, "maxL", "L1–LN with renumber gaps"],
  // Appendix B snapshot phrasing "max L# = L<N>" — was an unchecked blind spot (the true max drifted while the doc kept an older figure).
  [/max\s+L#\s*=\s*L(\d+)/gi, "maxL", "Appendix B snapshot: max L# = LN"],

  // meta/MEMORY.md size — tolerance ±50 because file grows ~5-15 lines per session between distills.
  [/(?:meta\/MEMORY\.md|`?skills\/meta\/MEMORY\.md`?)[\s\S]{0,80}?~?(\d{3,5})\s+lines/gi, "metaMemoryLines", "meta/MEMORY.md size", { tolerance: 50 }],
  [/(\d{3,5})\s+lines\s+of\s+meta\s+MEMORY/gi, "metaMemoryLines", "N lines of meta MEMORY", { tolerance: 50 }],

  // Active-recall hot tier additional phrasings. STRICT separator class avoids
  // greedy `.{0,5}` consuming digits (which caused "top-26" to be captured as "6").
  [/\btop[\s\-~]{0,3}(\d+)\s+most-cited/gi, "activeRecallHotTier", "top N most-cited", { tolerance: 1 }],

  // meta/RULES.md row count — tolerance ±5 because rows grow with new L# codifications.
  [/(?:meta\/RULES\.md|`?RULES\.md`?)[\s\S]{0,80}?~?(\d+)\s+(?:data\s+rows|rows)/gi, "metaRulesRows", "meta/RULES.md row count", { tolerance: 5 }],
  [/~?(\d+)-row\s+catalog/gi, "metaRulesRows", "N-row catalog (RULES.md)", { tolerance: 5 }],

  // === Meta-skill internal procedure-step counts (added 2026-06-06) ===
  // Closes the detector gap measured 2026-06-06: the
  // script tracked filesystem object counts but not these spec-internal counts,
  // so "9 self-audit checks" / "9 subcommands" drifted silently (caught manually).
  // Anchored on "self-audit"/"self-auditing" so /audit-check's "12 checks" (a
  // different gate) is never matched.
  // Number-word widening (2026-08-02 audit): "Twelve checks:" sat drifted at 13 while the
  // digit-only matchers read clean — the same class copy.md's number-word rule names. The
  // ([A-Za-z]+|\d+) alternation is the metaEntryPoints precedent: a non-number word
  // ("the"/"its") parses to NaN in parseCount and is skipped.
  [/self-auditing\s+\(([A-Za-z]+|\d+)\s+checks?\)/gi, "selfAuditChecks", "self-auditing (N checks)"],
  [/\b([A-Za-z]+|\d+)\s+self-audit\s+checks?\b/gi, "selfAuditChecks", "N self-audit checks"],
  // The Lecture-8 prose form ("…becomes the thing it critiques. Twelve checks:") — anchored
  // on the distinctive preceding clause so /audit-check's unrelated "12 checks" never matches.
  [/becomes the thing it critiques\.\s+([A-Za-z]+|\d+)\s+checks?:/gi, "selfAuditChecks", "self-audit prose: N checks"],
  // session-manifest mode count — anchored on the em-dash + backticked first mode so a
  // generic "N modes" elsewhere never matches ("Seven modes — `write` (snapshot…)").
  [/\b([A-Za-z]+|\d+)\s+modes\s+—\s+`write`/gi, "sessionManifestModes", "session-manifest N modes"],
  // Entry-point count may be a number-word ("eleven") — parseCount normalizes it,
  // and a non-number word (m[1]="the"/"main") parses to NaN and is skipped.
  [/\b([A-Za-z]+|\d+)\s+primary\s+entry\s+points?/gi, "metaEntryPoints", "N primary entry points"],
  [/\b(\d+)\s+subcommands?\b/gi, "metaSubcommands", "N /meta subcommands"],
];

// === COMPARISON.md self-counts: "Ours = **…**" banner + matrix-cell counts (2026-06-18 spot-audit) ===
// meta/COMPARISON.md's header banner restates 5 of our own counts in one line:
//   Ours = **N skills · N hooks · meta/MEMORY ~N lines · RULES.md N rows · maxL LN**
// These drift silently (drifted in ~1 day) and NO detector watched them —
// architecture-counts only guarded architecture.md; skill-lint's RULES_ROWCOUNT_DRIFT
// only guarded CLAUDE.md + active-recall.md (retired 2026-09-14 — zero such claims
// remain). Each pattern is anchored INSIDE the bold
// banner span (literal "·" = U+00B7) so it never matches external counts ("156 skills",
// "84 plugins") or the in-prose "maxL L<n>" phantom-citation reference on the SAME line.
// Tolerances: skills / hooks / RULES.md rows / maxL = EXACT; meta/MEMORY lines
// = ±50 (the banner prints "~", matching the architecture.md narrative-claim convention;
// the "~" sits OUTSIDE the (\d+) capture, so it is preserved on auto-fix).
const COMPARISON_BANNER_PATTERNS = [
  [/Ours = \*\*(\d+) skills/g, "skills", "COMPARISON banner: N skills"],
  [/skills · (\d+) hooks/g, "hooks", "COMPARISON banner: N hooks"],
  [/meta\/MEMORY ~?(\d+) lines/g, "metaMemoryLines", "COMPARISON banner: meta/MEMORY ~N lines", { tolerance: 50 }],
  [/RULES\.md (\d+) rows/g, "metaRulesRows", "COMPARISON banner: RULES.md N rows"],
  [/maxL L(\d+)\*\*/g, "maxL", "COMPARISON banner: maxL LN"],
  // matrix-cell self-counts (the banner detector
  // under-covered the GRID cells, which restate their own OURS counts and drift the same way):
  // Keyed to metaSubcommands, NOT metaEntryPoints: the cell says "subcommands", and keyed to the
  // entry-point count it certified "15 subcommands" here beside architecture.md's "14 subcommands".
  [/✅ (\d+) subcommands/g, "metaSubcommands", "COMPARISON matrix: N subcommands (Orchestration self-awareness cell)"],
  [/\| (\d+) \(monolithic\)/g, "skills", "COMPARISON matrix: N skills (Skill count cell)"],
];

// Verifier-integrity guard (BLIND≠CLEAN): these counts are REGEX-DERIVED from a
// section-header / anchor inside a source spec — a header reword silently breaks the
// regex and the counter returns 0 (demonstrated: the sniff-test rubric header already
// moved 13→14 once). A genuine 0 is implausible for every key here, so 0-with-source-
// present ⇒ probable anchor drift → warn, never auto-write the 0 into the docs.
const REGEX_DERIVED = {
  sniffTestTriggers: ".claude/skills/sniff-test/SKILL.md",
  selfAuditChecks: ".claude/skills/meta/SKILL.md",
  sessionManifestModes: "scripts/session-manifest.py", // grep-derived; a registration-style change would zero it
  metaEntryPoints: ".claude/skills/meta/SKILL.md",
  metaSubcommands: ".claude/skills/meta/SKILL.md", // = metaEntryPoints − 1 → inherits the same anchor
  activeRecallHotTier: ".claude/rules/active-recall.md",
  activeRecallBandO: ".claude/orchestrator/active-recall-orchestrator.md",
};
const isSuspectZero = (d) =>
  d.actual === 0 && REGEX_DERIVED[d.key] !== undefined && existsSync(join(REPO_ROOT, REGEX_DERIVED[d.key]));

// NARRATIVE-ANCHOR ROT GUARD (2026-08-02).
// isSuspectZero guards the COUNT SOURCE breaking (a counter reading 0 from an existing
// file). The narrative matchers had no equivalent: the drift loop only pushes an entry
// when a regex MATCHES, so a reworded doc sentence produces no match, no entry, and no
// signal — a stale number is then never re-checked, silently, forever. A narrative
// matcher registered against the doc is a claim that the SENTENCE EXISTS; for a key we
// expect the doc to state, zero matches across ALL its patterns while the doc exists is
// the same suspect-zero shape, surfaced instead of skipped.
// Per-KEY on purpose, never per-matcher: several keys carry alternative phrasings that
// legitimately match zero each — only all-zero for an expected key is suspect.
// Scope = the prose-anchored, rot-prone-by-design keys this commit family added
// (extend on encounter, and audit a key for legitimate-absence before adding it —
// a key whose claim the doc may deliberately drop would make this a standing nag).
const NARRATIVE_EXPECTED_KEYS = ["selfAuditChecks", "sessionManifestModes"];
function findAnchorRot(docText) {
  const rot = [];
  for (const key of NARRATIVE_EXPECTED_KEYS) {
    let total = 0;
    for (const [re, k] of PATTERNS) {
      if (k !== key) continue;
      re.lastIndex = 0; // matchAll iterates from the regex's current lastIndex — reset the shared object
      total += Array.from(docText.matchAll(re)).length;
    }
    if (total === 0) rot.push(key);
  }
  return rot;
}

function findDrifts(docText, counts, patterns = PATTERNS) {
  const drifts = [];
  for (const pattern of patterns) {
    const [regex, key, label, options = {}] = pattern;
    const tolerance = options.tolerance ?? 0;
    // Reset regex state (gi flag)
    const re = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = re.exec(docText)) !== null) {
      const claimed = parseCount(m[1]);
      // m[1] may be a non-number word (the metaEntryPoints pattern captures any
      // leading word, e.g. "the"/"main") — parseCount returns NaN; skip those.
      if (Number.isNaN(claimed)) continue;
      const actual = counts[key];
      if (Math.abs(claimed - actual) > tolerance) {
        // Compute line number
        const before = docText.substring(0, m.index);
        const line = before.split("\n").length;
        // Locate the token's position WITHIN the match (capture group 1's offset)
        const numberOffset = m[0].indexOf(m[1]);
        const numberStart = m.index + numberOffset;
        const numberEnd = numberStart + m[1].length;
        drifts.push({
          line,
          label,
          claimed,
          claimedToken: m[1], // original form (word or digit) for the apply-fix slice check
          replacement: matchedReplacement(m[1], actual), // rendered in the matched form
          actual,
          key,
          tolerance,
          numberStart,
          numberEnd,
          contextDisplay: extractContext(docText, m.index, 100),
        });
      }
    }
  }
  return drifts;
}

function extractContext(text, idx, span) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + span);
  return text.substring(start, end).replace(/\n/g, " ");
}

// --------------------------------------------------------------------------
// Auto-fix — for surgical replacements of single numbers
// --------------------------------------------------------------------------

function applyFixes(docText, drifts) {
  // Process by file position (descending) so earlier positions stay valid
  // when we splice in the (potentially different-length) replacement number
  const sortedDrifts = [...drifts].sort((a, b) => b.numberStart - a.numberStart);

  let updated = docText;
  let fixCount = 0;

  for (const drift of sortedDrifts) {
    const newClaim = drift.replacement; // matched form (word or digit)
    // Verify the token at the recorded position is still the claimed token
    const currentSlice = updated.substring(drift.numberStart, drift.numberEnd);
    if (currentSlice !== drift.claimedToken) {
      // Position drifted (likely earlier fix shifted text); skip — re-run will catch
      continue;
    }
    updated = updated.substring(0, drift.numberStart) + newClaim + updated.substring(drift.numberEnd);
    fixCount++;
  }

  return { updated, fixCount };
}

// --------------------------------------------------------------------------
// Listing-vs-count consistency check
// --------------------------------------------------------------------------
// For patterns like "Hooks (N files):" followed by a comma-separated list,
// verify the list count matches N and the listed names match filesystem.

function checkListings(docText) {
  const findings = [];

  // Helper: find a "**X (N files):**" section header and extract the lines that follow,
  // up to the next blank line OR the next "**" heading. This accommodates both
  // single-line listings (legacy) and multi-bullet sub-categorized listings
  // (e.g., hooks split by Claude-lifecycle / Git-pre-push / Orphan).
  // Returns { claimedCount, lineText } or null.
  function findSection(kindRegex) {
    const headerRe = new RegExp(`\\*\\*${kindRegex}\\s+\\((\\d+)\\s+files?\\):\\*\\*[^\\n]*\\n`);
    const headerMatch = docText.match(headerRe);
    if (!headerMatch) return null;
    const start = headerMatch.index + headerMatch[0].length;
    // Capture everything until: blank line OR new "**X (N files):**" header OR end-of-string.
    const rest = docText.slice(start);
    const stopMatch = rest.match(/\n\n|\n\*\*[A-Z][^\n]*\(\d+\s+files?\):/);
    const lineText = stopMatch ? rest.slice(0, stopMatch.index) : rest;
    return { claimedCount: parseInt(headerMatch[1], 10), lineText };
  }

  function checkKind(kind, fsGlob, fileRegex) {
    const section = findSection(kind === "hooks" ? "Hooks" : "Rules");
    if (!section) return;
    const names = section.lineText.match(fileRegex) || [];
    if (names.length !== section.claimedCount) {
      findings.push({
        type: "listing-count",
        kind,
        claimed: section.claimedCount,
        listed: names.length,
      });
    }
    const fsList = sh(`ls ${fsGlob} 2>/dev/null`).split("\n").map(p => p.replace(/^\.claude\//, "")).filter(Boolean);
    const listed = names.map(n => n.replace(/`/g, ""));
    const missing = fsList.filter(h => !listed.includes(h));
    const extra = listed.filter(l => !fsList.includes(l));
    if (missing.length > 0 || extra.length > 0) {
      findings.push({ type: "listing-content", kind, missing, extra });
    }
  }

  checkKind("hooks", ".claude/hooks/*.sh .claude/hooks/*.py", /`hooks\/[a-z0-9_-]+\.(sh|py)`/gi);
  checkKind("rules", ".claude/rules/*.md", /`rules\/[a-z0-9_-]+\.md`/gi);

  return findings;
}

// --------------------------------------------------------------------------
// Appendix C coverage check
// --------------------------------------------------------------------------
// Surfaces L#s cited in body but missing from the Appendix C table (gaps),
// AND L#s in Appendix C with no body citation (orphans). Not auto-fixable —
// adding a row needs a curated summary (per Process — Architecture Audit Step 3c);
// pruning an orphan is an owner judgment call. Both surface for owner review.

// ⛔ THE OPTIONAL PARENTHETICAL IS THE 2026-09-08 FIX, AND ITS INNER CLASS IS THE WHOLE
// SAFETY ARGUMENT — do not "simplify" it to `[^)]*`. The repo's L#-annotation pass rewrites
// a bare `L1` into `L1 (knowledge-needed build trigger)`, which puts a parenthetical between
// the number and the dash; the un-widened form `\bL\d+\s*(?:[–—-]|through)\s*L\d+\b` then
// MISSES every annotated range, so a range endpoint stops being exempt and the check reports
// a phantom Appendix C gap for a number that needs no row. Measured on this doc: 5 of its 7
// ranges are annotated, and one run surfaced exactly that phantom twice.
//
// This widens an EXEMPTION, and over-matching an exemption silently hides a REAL coverage
// gap — the expensive direction. `(?:[^)L]|L(?!\d))*` is what bounds it: the parenthetical
// may contain anything EXCEPT an L followed by a digit, so `L1 (see L<a>)–L<b>` does not
// match at all and L<a> keeps needing its own row. Failing to match is the SAFE outcome here
// (a phantom gap is reported and read), so the guard errs toward over-reporting by
// construction rather than by judgement.
//
// ⛔ THE JOINER IS AS LOAD-BEARING AS THE INNER CLASS, AND IT IS WHERE THE FIRST VERSION OF THIS
// FIX WENT WRONG (caught and fixed the same day). The joiner
// is `[ \t]*` and NOT `\s*`, and its dash set EXCLUDES the em dash `—`. Both restrictions are
// deliberate:
//   · `\s*` CROSSES A LINE BREAK, so `as in L<a> (archive)\n- L<b> is separate` reads as one
//     range and exempts two unrelated lessons. A markdown bullet is the shape that does it.
//   · `—` is this corpus's ordinary PROSE separator, so `fixed in L<a> (archive) — L<b> is the
//     sibling` reads as a range for the same reason.
// MEASURED, four shapes, parent regex vs the first fix vs this one: the two ANNOTATED shapes read
// parent=0 → firstfix=1, i.e. THIS COMMIT'S OWN PREDECESSOR OPENED THEM. The mechanism is
// counter-intuitive and worth keeping: before the parenthetical was allowed, the annotator's pass
// accidentally DE-matched em-dash prose by inserting something the regex could not cross, so
// making the correct fix re-enabled it. The two BARE shapes were pre-existing (parent=1) and the
// narrowed joiner closes those too. Live exposure on architecture.md is currently zero of all
// four, but both halves are one edit apart: the doc already carries `L<n> (stale classification
// re-verify) —` and three `— L#` spellings. Narrowing costs nothing measured — the same 7 live
// ranges are found before and after, byte-identical, and NONE of the 7 uses an em dash.
//
// AT MODULE SCOPE, not inside the function, so `--self-test` can assert on the regex itself
// rather than only on the coverage verdict it feeds — a guard no arm can reach is shipped
// appearance (session-cadence.md).
// ⛔ `matchAll` CLONES THE REGEX **AND COPIES `lastIndex` INTO THE CLONE** — this comment claimed
// the opposite ("carries no `lastIndex` state between calls") until 2026-09-08, measured and
// re-measured here: after a single `RANGE_RE.test(body)` the very next `matchAll` returns 1 span
// where a fresh one returns 2. The shared constant is safe TODAY only because both consumers
// (`matchAll` here, `String#match` in the self-test) leave `lastIndex` at 0 — `.match` resets it.
// **Adding the first `.test()` or `.exec()` on this constant silently poisons the next
// `matchAll`.** The failure direction is OVER-REPORT, not silent exemption: `\b` is evaluated
// against the whole input, so a mid-string start can MISS a span but can never invent one. Arm R8
// pins `lastIndex === 0`. Arms: `--self-test` R1-R8 (the regex) and A1-A8 (the coverage verdict).
const RANGE_RE =
  /\bL\d+(?:[ \t]*\((?:[^)L]|L(?!\d))*\))?[ \t]*(?:[–-]|through)[ \t]*L\d+\b/g;

// The doc's own Appendix B snapshot, `max L# = L<N>`, is a COUNT claim, not a teaching
// citation: while the doc lags the true max, <N> is neither maxL nor inside a range, and it
// used to be reported as a missing Appendix C row — a second report of the same lag the count
// check already carries, with the wrong remedy (measured 2026-09-29 on a snapshot three lessons behind maxL 2061).
// Keyed on the PHRASE, never the number, so the same L# cited on its own elsewhere still owes a
// row (self-test A10). Same `matchAll`-only rule as RANGE_RE above. ⛔ SAME SHAPE AS THE DRIFT
// PATTERN IT DEFERS TO (the "Appendix B snapshot: max L# = LN" row in the count-pattern table,
// `/max\s+L#\s*=\s*L(\d+)/gi`): a narrower literal let `Max L# = …` or `max L#=…` bring the double
// report back. Not too wide — anything it exempts is still reported
// as count drift. Self-test A11.
const SNAPSHOT_MAX_RE = /max\s+L#\s*=\s*L\d+\b/gi;

function checkAppendixCoverage(docText, counts) {
  const findings = [];
  const parts = docText.split("## Appendix C — L# Reference Index");
  if (parts.length < 2) return findings; // no Appendix C — skip silently
  const [body, appx] = parts;

  // Body L# citations — up to 4 digits (real lessons crossed four digits in 2026-07; the old
  // {1,3} cap made every four-digit citation invisible to this gate — the resulting gap shipped
  // under a green "coverage exact" for a day). The cap's file:line rationale was
  // overstated, not void: a bare `file.md:1234` ref never matches, but permalink-style
  // `file.md:L<n>` does — 2 pre-existing `:L` refs in meta/MEMORY.md (measured
  // 2026-08-02), a ~0.2% over-count either cap admits equally.
  // Track each L#'s occurrence positions so we can distinguish a SPAN endpoint (the
  // "L<a>" / "L<b>" in an "L<a>–L<b>" accretion range) from a substantive content
  // citation: span endpoints denote the lesson range, not a teaching reference.
  const rangeSpans = Array.from(body.matchAll(RANGE_RE)).map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const snapshotSpans = Array.from(body.matchAll(SNAPSHOT_MAX_RE)).map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const insideRange = (pos) =>
    rangeSpans.some(([s, e]) => pos >= s && pos < e) ||
    snapshotSpans.some(([s, e]) => pos >= s && pos < e);

  const occ = new Map(); // L# -> { total, inside } occurrence counts
  for (const m of body.matchAll(/\bL(\d{1,4})\b/g)) {
    const n = parseInt(m[1], 10);
    const rec = occ.get(n) || { total: 0, inside: 0 };
    rec.total += 1;
    if (insideRange(m.index)) rec.inside += 1;
    occ.set(n, rec);
  }
  const bodyLs = new Set(occ.keys());

  // Appendix C table rows — match `| L<N>` at the start of a line.
  const appxLs = new Set(
    Array.from(appx.matchAll(/^\| L(\d+)/gm)).map((m) => parseInt(m[1], 10)),
  );

  // Range endpoints denote the lesson SPAN, not a content citation, so they must NOT
  // require their own Appendix C row. Exclude from the coverage-GAP check (orphan check
  // still runs against full bodyLs):
  //   (a) L1 (trivially present) + current max-L (churns every codification) — always.
  //   (b) Any L# whose EVERY body occurrence sits inside an "L#–L#" range span — a
  //       span-only endpoint (e.g. the "L<b>" in a stale "L<a>–L<b>" accretion range,
  //       which previously tripped a phantom gap until the range was hand-de-staled).
  //       An L# that ALSO appears standalone anywhere is a real citation → NOT excluded.
  const spanOnly = new Set(
    [...occ.entries()].filter(([, r]) => r.total === r.inside).map(([n]) => n),
  );
  const rangeEndpoints = new Set([1, counts.maxL, ...spanOnly].filter(Boolean));

  const missing = [...bodyLs]
    .filter((l) => !appxLs.has(l) && !rangeEndpoints.has(l))
    .sort((a, b) => a - b);
  const orphan = [...appxLs].filter((l) => !bodyLs.has(l)).sort((a, b) => a - b);

  if (missing.length > 0) {
    findings.push({ type: "appx-c-missing", lessons: missing });
  }
  if (orphan.length > 0) {
    findings.push({ type: "appx-c-orphan", lessons: orphan });
  }
  return findings;
}

// --------------------------------------------------------------------------
// Drift telemetry
// --------------------------------------------------------------------------
// Appends one JSON line per `check` or `fix` invocation to:
//   .claude/logs/architecture-doc-drift.jsonl
// After ~30 days, query the log to see which homes/sections drift fastest
// and recalibrate detection patterns / refresh cadence accordingly.

function logTelemetry(event) {
  const logDir = join(REPO_ROOT, ".claude/logs");
  try {
    if (!existsSync(logDir)) {
      execSync(`mkdir -p ${logDir}`, { stdio: "ignore" });
    }
    const logPath = join(logDir, "architecture-doc-drift.jsonl");
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    execSync(`cat >> ${logPath}`, { input: line, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // Telemetry is best-effort; never block the primary command on log-write failures.
  }
}

// --------------------------------------------------------------------------
// Self-test — `node scripts/architecture-counts.mjs --self-test`
// --------------------------------------------------------------------------
// Covers ONE thing: the Appendix C range-span exemption, which is the only part of this
// script that can hide a finding rather than merely miss one. Everything else here
// OVER-reports on failure (a stale count is loud); `rangeEndpoints` is subtractive, so a
// regex that matches too much silently exempts an L# that genuinely owes a row.
//
// ⛔ THE A3/A5 ARMS ARE THE MANDATORY HALF AND THEY ARE NOT DECORATION. The fix's `done-when`
// requires an arm that goes
// RED when a genuinely uncovered L# is wrongly exempted — A3 pins a standalone citation
// beside an annotated range, A5 pins two L#s INSIDE a parenthetical. Simplify the inner
// class to `[^)]*` and A5 goes RED; that is the mutation this file's own comment forbids,
// and it is the one a future reader is most likely to try.
//
// Fixtures are hand-written literals with hand-written expected values — no expectation is
// read from architecture.md, from `counts`, or from the SUT's own output (the self-grading
// way, tests-unit.md). `maxL` is pinned at 999 so the always-exempt L1/maxL pair
// is a known constant rather than whatever the live doc happens to end at.

function runSelfTest() {
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail });
  const eq = (name, actual, expected) =>
    ok(
      name,
      JSON.stringify(actual) === JSON.stringify(expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );

  // --- R arms: the regex itself ------------------------------------------------------
  const matches = (s) => (s.match(RANGE_RE) || []).length > 0;

  ok("R1 bare hyphen range matches", matches("see L1-L247 for the span"));
  ok(
    "R2 ANNOTATED range matches (THE FIX — this is what the L#-annotator produces)",
    matches("see L9300 (mass-substitution pre-flight)–L9400 for the span"),
  );
  ok("R3 `through` spelling matches", matches("L1 through L9500 covers it"));
  ok(
    "R4 parenthetical CONTAINING an L-number does NOT match (safe direction)",
    !matches("L9300 (see L9500 and L9600)–L9400 is the span"),
  );
  ok(
    "R5 ordinary prose naming two lessons does NOT match",
    !matches("ordinary prose about L9300 and L9400 as separate lessons"),
  );
  // R6/R7/A8 are the JOINER arms, added 2026-09-08 in a review fold. All three are RED
  // against the regex the first version of the fix shipped: it joined on `\s*`
  // (which crosses a line break) and admitted the em dash (this corpus's prose separator), so
  // two unrelated lessons on either side of ordinary prose read as one range and were exempted.
  ok(
    "R6 an em dash between two lessons is PROSE, not a range",
    !matches("fixed in L9300 (archive) — L9400 is the sibling"),
  );
  ok(
    "R7 a range cannot cross a LINE BREAK (a markdown bullet is the shape that does it)",
    !matches("as in L9300 (archive)\n- L9400 is separate"),
  );
  ok(
    "R8 no consumer advances the shared /g regex — matchAll COPIES lastIndex into its clone",
    RANGE_RE.lastIndex === 0,
  );

  // --- A arms: the coverage verdict, through the real checkAppendixCoverage ----------
  const doc = (body, appxRows = []) =>
    `${body}\n\n## Appendix C — L# Reference Index\n\n| L# | Summary |\n|---|---|\n${appxRows
      .map((n) => `| L${n} | fixture row |`)
      .join("\n")}\n`;
  const run = (body, appxRows) =>
    checkAppendixCoverage(doc(body, appxRows), { maxL: 999 });
  const missingOf = (f) => f.find((x) => x.type === "appx-c-missing")?.lessons ?? [];
  const orphanOf = (f) => f.find((x) => x.type === "appx-c-orphan")?.lessons ?? [];

  // A1 — the fix's positive case: both endpoints of an ANNOTATED range are span-only, so
  // neither owes an Appendix C row. Under the pre-fix regex this reported [9300, 9400].
  eq(
    "A1 annotated-range endpoints are exempt (no phantom gap)",
    missingOf(run("Accretion range L9300 (mass-substitution pre-flight)–L9400 covers the wave.")),
    [],
  );

  // A2 — the same range unannotated, to prove A1 is not passing for some unrelated reason.
  eq(
    "A2 bare-range endpoints are exempt too (control for A1)",
    missingOf(run("Accretion range L9300–L9400 covers the wave.")),
    [],
  );

  // A3 — ⛔ MUTATION ARM. A real standalone citation with no Appendix C row, sitting right
  // beside an annotated range, must STILL be reported. Any widening that swallows it turns
  // this green→red.
  eq(
    "A3 a body-cited L# with no Appendix C row is STILL reported beside an annotated range",
    missingOf(
      run(
        "Accretion range L9300 (mass-substitution pre-flight)–L9400 covers the wave. " +
          "L555 explains why the clamp is needed.",
      ),
    ),
    [555],
  );

  // A4 — an endpoint that ALSO appears standalone is a real citation, not a span endpoint.
  eq(
    "A4 an L# both inside a range AND standalone is NOT exempt",
    missingOf(
      run(
        "Accretion range L9300 (mass-substitution pre-flight)–L9400 covers the wave. " +
          "L9400 is also cited on its own here.",
      ),
    ),
    [9400],
  );

  // A5 — ⛔ MUTATION ARM, and the one that pins the inner character class. L9500 and L9600 sit
  // inside the parenthetical; the shipped regex refuses the whole range so all four numbers
  // report (over-reporting, the safe direction). Replace `(?:[^)L]|L(?!\d))*` with `[^)]*`
  // and the span swallows 9500/9600 → missing becomes [] → RED.
  eq(
    "A5 L#s inside a parenthetical still owe their own rows (inner class is load-bearing)",
    missingOf(run("L9300 (see L9500 and L9600)–L9400 is the span.")),
    [9300, 9400, 9500, 9600],
  );

  // A6 — the orphan half is untouched by any of the above.
  const a6 = run("L9300 is cited in the body.", [9300, 777]);
  eq("A6 orphan detection still fires", orphanOf(a6), [777]);
  eq("A6b orphan fixture reports no gap", missingOf(a6), []);

  // A7 — the always-on exemptions (L1 and current maxL) still hold.
  eq(
    "A7 L1 and maxL stay exempt without a range",
    missingOf(run("L1 is trivially present and L999 is the current max.")),
    [],
  );

  // A8 — ⛔ THE JOINER'S MUTATION ARM, and the one that was RED against the first fix. Two unrelated
  // lessons separated by ordinary em-dash prose must BOTH still owe Appendix C rows. Widen the
  // joiner back to `\s*` or re-admit `—` and this returns [] — the silent exemption again, one
  // clause left of the inner class A5 pins.
  eq(
    "A8 em-dash prose does NOT exempt the lessons on either side of it",
    missingOf(run("fixed in L9300 (archive) — L9400 is the sibling.")),
    [9300, 9400],
  );

  // A12 — the body regex reads FOUR-digit lessons: its {1,3} cap once hid every four-digit citation.
  // This arm pins it on a lone citation, with no range or snapshot beside it. L9700 sits above the ledger.
  eq("A12 a four-digit body citation with no Appendix C row is reported", missingOf(run("L9700 explains the clamp.")), [9700]);

  // A9 — the doc's own `max L# = L<N>` snapshot is a COUNT claim, not a citation. While the doc
  // lags the true max (maxL 999, doc still says 990) the snapshot number is neither maxL nor
  // inside a range, so it used to be reported as a missing Appendix C row — a second report of
  // the same count lag the ARCH_DOC_DRIFT arm already carries, with the wrong remedy attached
  // (measured 2026-09-29 on a snapshot three lessons behind a maxL of 2061).
  eq(
    "A9 a lagging `max L# = L<N>` snapshot owes no Appendix C row",
    missingOf(run("Lessons L1–L990 exist (max L# = L990; the max end churns).")),
    [],
  );

  // A10 — ⛔ MUTATION ARM for A9. The same number cited on its own elsewhere is a real citation
  // and must still be reported; an exemption that keys on the NUMBER instead of the PHRASE turns
  // this red.
  eq(
    "A10 the snapshot's number cited standalone elsewhere is STILL reported",
    missingOf(run("Lessons L1–L990 exist (max L# = L990). L990 explains the clamp.")),
    [990],
  );

  // A11 — the exemption matches every spelling the drift pattern does (capitalised, no spaces).
  eq(
    "A11 `Max L#=L990` (drift-pattern spelling) owes no Appendix C row either",
    missingOf(run("Lessons L1–L990 exist (Max L#=L990; the max end churns).")),
    [],
  );

  // ------------------------------------------------------------------
  // P1-P3 — `conceptual-due`'s prior-max read, post-archive-split.
  //
  // ⛔ THE ARM THAT WOULD HAVE CAUGHT IT. The lessons half of the cumulative-drift gate went
  // dark when `last-reviewed` crossed 2026-08-06: the prior-max read took `MEMORY.md` alone,
  // which is a ROUTER after the split and carries no lesson headers, so `maxLFromText` returned
  // 0, the delta went null, and every run printed PARTIAL while blaming git.
  //
  // P1 is the RED-first arm — it FAILS against the router-only read and passes against the
  // union. Fixtures are hand-written and the expected value is a literal; nothing is read from
  // the repo, from git, or from the SUT's own output.
  const postSplitTree = () => ["MEMORY.md", "MEMORY-ARCHIVE-2026-04-14-2026-08-05.md", "README.md"];
  const postSplitShow = (_sha, name) =>
    name === "MEMORY.md"
      ? "# Meta memory router\n\n| shard | range |\n|---|---|\n| MEMORY-ARCHIVE-2026-04-14-2026-08-05.md | L1-L1500 |\n"
      : "## 2026-08-05 — L1500: the newest lesson in the shard\n\nbody\n";

  eq(
    "P1 prior-max reads the TIER UNION at a post-split ref (router alone would read 0)",
    priorMaxLAt("deadbeef", postSplitTree, postSplitShow),
    { max: 1500, cause: null },
  );

  // P2 — a PRE-split ref, where every lesson still lived in MEMORY.md. The union must not
  // regress the case the old single-path read handled correctly.
  eq(
    "P2 prior-max still reads a pre-split ref, where the router IS the corpus",
    priorMaxLAt("deadbeef", () => ["MEMORY.md"], () => "## 2026-07-01 — L900: a pre-split lesson\n"),
    { max: 900, cause: null },
  );

  // P3 — the null arms. `max: null` means "could not be computed", never "zero lessons", and each
  // of the four early returns names ITSELF. They are four different facts — no commit, no directory
  // yet, git show failing, a parser out of step — and the first fix of this read collapsed three of
  // them into one guessed sentence.
  eq(
    "P3 prior-max names each of its four null causes distinctly",
    [
      priorMaxLAt("", postSplitTree, postSplitShow),
      priorMaxLAt("deadbeef", () => [], postSplitShow),
      priorMaxLAt("deadbeef", () => ["MEMORY.md"], () => ""),
      priorMaxLAt("deadbeef", () => ["MEMORY.md"], () => "# router, no lessons\n"),
    ],
    [
      { max: null, cause: "no-sha" },
      { max: null, cause: "no-files" },
      { max: null, cause: "blank-read" },
      { max: null, cause: "no-header" },
    ],
  );

  // ------------------------------------------------------------------
  // G1-G7 — `classifyLessonsGate`: MEASURED vs EMPTY vs DARK. Every expected value is a literal.
  // `gv` keeps the two fields a verdict turns on and drops the prose reason, which G7 checks separately.
  const gv = (g) => ({ delta: g.delta, dark: g.dark });
  const HEALTHY = 27; // the canary: meta-memory files git lists at HEAD in a healthy repo

  // G1 — ⛔ THE ARM FOR THE GREEN PASS THE FIRST FIX CREATED. A failed live read is 0, and against
  // a real prior of 1823 that was −1823: under the `>= 30` threshold, so it printed ✅.
  eq(
    "G1 a zero live max against a real prior is DARK, never a delta",
    gv(classifyLessonsGate({ max: 1823, cause: null }, 0, HEALTHY)),
    { delta: null, dark: true },
  );
  // G1b — the same zero with NOTHING to compare. Without the live guard this reads EMPTY, i.e.
  // PARTIAL, and a broken live reader hides behind a legitimate-looking absence.
  eq(
    "G1b a zero live max is DARK even when the prior is legitimately empty",
    gv(classifyLessonsGate({ max: null, cause: "no-sha" }, 0, HEALTHY)),
    { delta: null, dark: true },
  );
  // G2 — a live max BELOW the prior, both non-zero. The newest lesson leaving the tier causes it
  // legitimately, and so does a bad read; either way the two refs count different corpora, so it must
  // not come out as a negative "growth" figure.
  eq(
    "G2 a live max below the prior is DARK, never a negative delta",
    gv(classifyLessonsGate({ max: 1823, cause: null }, 1700, HEALTHY)),
    { delta: null, dark: true },
  );
  // G2b — and its reason names the tier-leaving causes BEFORE the read failure. The case is rare,
  // which is what makes it confusing when it fires: a reason that only says "a read is wrong" sends
  // the operator hunting a broken git when the newest lesson may simply have left the tier.
  // `.includes` alone could not see the ORDER this arm's message promises (a reason naming the
  // read failure first and the retirement sweep last passed it), so the arm compares positions.
  {
    const why = classifyLessonsGate({ max: 1823, cause: null }, 1700, HEALTHY).why || "";
    const r = why.indexOf("retirement sweep");
    const w = why.indexOf("reads is wrong");
    ok(
      "G2b the falling-max reason names the retirement sweep before any read failure",
      r >= 0 && (w === -1 || r < w),
      "the reason must name the retirement before any read failure",
    );
  }
  // G3 — the canary. A broken git makes `rev-list` return "" (so: no-sha) and ls-tree return
  // nothing at HEAD. That must read DARK — "no commit found" would be the false cause again.
  eq(
    "G3 a zero HEAD canary is DARK even when the prior says no-sha",
    gv(classifyLessonsGate({ max: null, cause: "no-sha" }, 1886, 0)),
    { delta: null, dark: true },
  );
  // G4 — the legitimate absences, with git proven able to list. The meta dir did not exist before
  // 2026-04-14, so an anchor before that has nothing to compare: EMPTY, reported as PARTIAL.
  eq(
    "G4 no-sha and no-files with a healthy canary are EMPTY, not dark",
    [
      gv(classifyLessonsGate({ max: null, cause: "no-sha" }, 1886, HEALTHY)),
      gv(classifyLessonsGate({ max: null, cause: "no-files" }, 1886, HEALTHY)),
    ],
    [
      { delta: null, dark: false },
      { delta: null, dark: false },
    ],
  );
  // G5 — files listed but unreadable, or read but header-less: both are the INSTRUMENT.
  eq(
    "G5 blank-read and no-header are DARK",
    [
      gv(classifyLessonsGate({ max: null, cause: "blank-read" }, 1886, HEALTHY)),
      gv(classifyLessonsGate({ max: null, cause: "no-header" }, 1886, HEALTHY)),
    ],
    [
      { delta: null, dark: true },
      { delta: null, dark: true },
    ],
  );
  // G6 — the healthy path, on the numbers the review reconciled at the 2026-08-05 anchor.
  eq(
    "G6 a healthy read yields the delta and no reason",
    classifyLessonsGate({ max: 1084, cause: null }, 1886, HEALTHY),
    { delta: 802, dark: false, gitDark: false, why: null },
  );
  // G6b — a failing git darkens the WHOLE gate: the new-infra and meta-commit counts are git reads
  // too, and under a broken git they come back 0, which the caller would print as a clean zero.
  // `gitDark` is what tells it not to. It must be set whenever the canary fails, whatever else the
  // verdict says, and never otherwise.
  eq(
    "G6b a failing canary sets gitDark on every verdict, and nothing else does",
    [
      classifyLessonsGate({ max: null, cause: "no-sha" }, 1886, 0),
      classifyLessonsGate({ max: 1084, cause: null }, 1886, 0),
      classifyLessonsGate({ max: 1823, cause: null }, 0, 0),
      classifyLessonsGate({ max: null, cause: "no-files" }, 1886, HEALTHY),
      classifyLessonsGate({ max: null, cause: "no-header" }, 1886, HEALTHY),
      classifyLessonsGate({ max: 1084, cause: null }, 1886, HEALTHY),
    ].map((g) => g.gitDark),
    [true, true, true, false, false, false],
  );
  // G7 — every non-measured state carries its OWN reason. One shared sentence is the defect this
  // gate has now had twice ("(git unavailable)", then one guess for three causes).
  const reasons = [
    classifyLessonsGate({ max: 1823, cause: null }, 0, HEALTHY),
    classifyLessonsGate({ max: 1823, cause: null }, 1700, HEALTHY),
    classifyLessonsGate({ max: null, cause: "no-sha" }, 1886, 0),
    classifyLessonsGate({ max: null, cause: "no-sha" }, 1886, HEALTHY),
    classifyLessonsGate({ max: null, cause: "no-files" }, 1886, HEALTHY),
    classifyLessonsGate({ max: null, cause: "blank-read" }, 1886, HEALTHY),
    classifyLessonsGate({ max: null, cause: "no-header" }, 1886, HEALTHY),
  ].map((g) => g.why);
  ok(
    "G7 each of the seven non-measured states has its own reason",
    reasons.every((w) => typeof w === "string" && w.length > 0) && new Set(reasons).size === reasons.length,
    `reasons: ${JSON.stringify(reasons)}`,
  );

  // ------------------------------------------------------------------
  // C1-C3 — the REAL git accessors. ⛔ The router-only bug lived in the git-string half, and the
  // first fix left that half in untested lambdas at the call site. Two parts are invisible and
  // each alone darkens the gate with every other arm green: `:(top)` (an ls-tree pathspec is
  // cwd-relative) and the trailing slash (without it ls-tree lists the directory entry, 1 line,
  // instead of its children).
  eq(
    "C1 the ls-tree command carries :(top) AND the trailing slash",
    lsTreeMetaCmd("abc1234"),
    "git ls-tree --name-only abc1234 ':(top).claude/skills/meta/'",
  );
  eq(
    "C2 the show command addresses the file by rev:path",
    showMetaCmd("abc1234", "MEMORY.md"),
    "git show abc1234:.claude/skills/meta/MEMORY.md",
  );
  eq(
    "C3 ls-tree output parses to basenames and drops blank lines",
    parseLsTreeNames(".claude/skills/meta/MEMORY.md\n.claude/skills/meta/MEMORY-ARCHIVE-2026-08-06-2026-08-10.md\n\n"),
    ["MEMORY.md", "MEMORY-ARCHIVE-2026-08-06-2026-08-10.md"],
  );

  // ------------------------------------------------------------------
  // B1-B4 — the Preface bold-count patterns. The path leg must END at
  // the closing paren, or a bullet naming a SUBSET of the directory scores against the total and `fix`
  // rewrites a correct subset count. B2 and B4 go RED on the unterminated patterns. Fixtures are
  // hand-written; the asterisk is written as * so no slash-star pair appears in this source.
  const ptnFor = (label) => {
    const entry = PATTERNS.find(([, , l]) => l === label);
    if (!entry) throw new Error(`self-test: no PATTERNS entry labelled ${label}`);
    return entry[0];
  };
  const ptnCounts = (re, s) => [...s.matchAll(re)].map((m) => Number(m[1]));
  const PTN_SKILLS = ptnFor("skills (in .claude/skills/)");
  const PTN_AGENTS = ptnFor("agents (in .claude/agents/)");
  eq(
    "B1 skills: the Preface phrasing still counts",
    ptnCounts(PTN_SKILLS, "- **107 skills** (`.claude/skills/*/`) — domain experts, personas"),
    [107],
  );
  eq(
    "B2 skills: a bullet naming a SUBSET of the directory does not count",
    ptnCounts(PTN_SKILLS, "- **12 skills** (`.claude/skills/external-*/`) — catalog entries"),
    [],
  );
  eq(
    "B3 agents: the Preface phrasing still counts",
    ptnCounts(PTN_AGENTS, "- **55 agents** (`.claude/agents/`) — 54 agent definitions"),
    [55],
  );
  eq(
    "B4 agents: a bullet naming a SUBSET of the directory does not count",
    ptnCounts(PTN_AGENTS, "- **3 agents** (`.claude/agents/external-*.md`) — catalog agents"),
    [],
  );

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.pass && r.detail) console.log(`        ${r.detail}`);
  }
  console.log(`\n--self-test: ${passed} passed / ${failed} failed / ${results.length} arms`);
  return failed === 0 ? 0 : 1;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

const cmd = process.argv[2] || "check";

// Dispatched BEFORE the DOC_PATH existence check and before computeCounts(), so the arms
// run on a clean checkout / detached worktree where architecture.md may not be present and
// nothing here depends on the live doc. A self-test that needs the artifact it guards is
// one bad checkout away from a void run reported as a pass.
if (cmd === "--self-test" || cmd === "self-test") {
  process.exit(runSelfTest());
}

if (!existsSync(DOC_PATH)) {
  console.error(`Architecture doc not found at ${DOC_PATH}`);
  process.exit(2);
}

const counts = computeCounts();

if (cmd === "list") {
  console.log(JSON.stringify(counts, null, 2));
  // MINT-TIME WARNING (2026-07-31). Two lessons both record that `maxL` is a READ, not a
  // RESERVATION — and the 07-31 arc measured WHY that knowledge never propagated: the
  // pre-push gate PRINTS the cede rule at FAILURE time (which propagated perfectly, every
  // seat ceded correctly and independently), while NOTHING printed the re-check rule at
  // MINT time (which propagated to nobody — six seats re-derived the protocol from scratch
  // over ~90 minutes while it sat written in the file they were all editing). This is the
  // only surface every minting seat provably traverses, so the rule goes HERE.
  //
  // stderr, NOT stdout, and that is load-bearing: the documented usage is
  // `... list | grep '"maxL"'`, and any extra stdout line would corrupt the JSON for a
  // parsing consumer. A warning must not break the plane its host is read on — which is
  // the same class of error the 07-31 arc spent the day measuring.
  // SUPERSEDED-IN-PART the same day: `scripts/lesson-mint.mjs` removes the read
  // entirely — it allocates by POSITION in an atomic O_APPEND, so two concurrent mints land on
  // two different lines and cannot receive the same number. This warning now leads with that and
  // keeps substitute-in-the-same-call as the fallback for anyone still deriving. Updated ~20min
  // after it shipped, which is the point: guidance rots at the speed of the fleet, and a warning
  // that names the second-best remedy teaches it.
  console.error(
    `⚠ maxL ${counts.maxL} is a READ, not a RESERVATION — a peer may mint L${counts.maxL + 1} before you append.\n` +
      `  ✅ PREFERRED — allocate, do not derive:\n` +
      `       node scripts/lesson-mint.mjs status                              # read in-flight slugs FIRST\n` +
      `       node scripts/lesson-mint.mjs mint --sid <sid8> --slug "<topic>"  # allocated, not derived\n` +
      `     Your number is ALLOCATED, never derived from maxL+1 — so two concurrent mints cannot\n` +
      `     receive the same one, and an issued number is never reassigned. --slug is what makes a\n` +
      `     CONTENT duplicate visible; the push gate cannot see those.\n` +
      `  FALLBACK if you must derive: SUBSTITUTE maxL in the SAME bash call as the append (sed a\n` +
      `     @@A@@ placeholder); never bake the literal into a heredoc composed in a later turn.\n` +
      `     Applies to a collision RENUMBER too.\n` +
      `  → .claude/skills/meta/references/process-learn.md Step 2b`,
  );
  process.exit(0);
}

if (cmd === "conceptual-due") {
  // Cumulative "is a real Tier-2/3 CONCEPTUAL pass due since the last full audit?"
  // signal — distinct from `check` (per-run count drift). The count-sync keeps the
  // NUMBERS fresh every /wrap; this catches the LECTURE PROSE silently lagging as
  // whole subsystems land between full audits. (2026-07-01 finding: 5 skills + 2
  // hooks + ~42 lessons had accumulated un-integrated since 2026-06-23 while the
  // git log read as if audits were running — they were count-syncs.)
  //   Anchor = the doc's `last-reviewed` frontmatter. INVARIANT: only a genuine
  //   Tier-2/3 pass bumps `last-reviewed`; a bare `fix`/count-sync must NOT (it
  //   doesn't touch the frontmatter — see the architecture-audit spec, Step 10).
  //   Gate on new-infra + new-lessons, NOT raw commit count (commit-count
  //   is noise). Surface only; never blocks. Wired: /wrap Step 7d + /meta status.
  //   Optional arg overrides the anchor for testing/manual use:
  //   `conceptual-due 2026-06-23` answers "what has accumulated since <date>".
  const shTry = (c) => { try { return sh(c); } catch { return ""; } };
  const argDate = process.argv[3];
  const lr = (argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate))
    ? argDate
    : (readFileSync(DOC_PATH, "utf-8").match(/^last-reviewed:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1];
  if (!lr) {
    console.log("conceptual-due: no `last-reviewed` frontmatter (and no date arg) — cannot compute.");
    process.exit(0);
  }
  const added = shTry(`git log --since="${lr} 00:00:00" --diff-filter=A --name-only --pretty=format: -- .claude/skills .claude/hooks .claude/rules .claude/commands`)
    .split("\n").filter(Boolean);
  const nSkill = added.filter((f) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f)).length;
  const nHook = added.filter((f) => /^\.claude\/hooks\/[^/]+\.(sh|py)$/.test(f)).length;
  const nRule = added.filter((f) => /^\.claude\/rules\/[^/]+\.md$/.test(f)).length;
  const nCmd = added.filter((f) => /^\.claude\/commands\/[^/]+\.md$/.test(f)).length;
  const infra = nSkill + nHook + nRule + nCmd;
  const priorSha = shTry(`git rev-list -1 --before="${lr} 23:59:59" HEAD`);
  // TIER UNION at the historical ref, through the module-level accessors so their load-bearing
  // parts (`:(top)`, the trailing slash) are pinned by --self-test — see lsTreeMetaCmd.
  const lsTree = (sha) => parseLsTreeNames(shTry(lsTreeMetaCmd(sha)));
  const prior = priorMaxLAt(priorSha, lsTree, (sha, name) => shTry(showMetaCmd(sha, name)));
  // Liveness canary: HEAD always carries the meta tier, so a zero here is the instrument.
  const headTierCount = lsTree("HEAD").filter((f) => MEMORY_TIER_RE.test(f)).length;
  const gate = classifyLessonsGate(prior, counts.maxL, headTierCount);
  const lessonDelta = gate.delta;
  const metaCommits = shTry(`git log --since="${lr} 00:00:00" --pretty=format:%s`)
    .split("\n").filter(Boolean)
    .filter((s) => /^(meta|memory|hook|skill|rule|orient|wrap|docs\((architecture|meta)|feat\(skill|chore\(migration)/i.test(s)).length;
  const T = { infra: 3, lessons: 30 };
  const due = infra >= T.infra || (lessonDelta !== null && lessonDelta >= T.lessons);
  const lessonStr = gate.dark
    ? "lessons Δ DARK"
    : lessonDelta === null ? `lessons Δ n/a (${gate.why})` : `+${lessonDelta} lessons (L${prior.max}→L${counts.maxL})`;
  // Under a failing git the infra and meta-commit counts are git reads that came back empty, so they
  // are printed as UNMEASURED rather than as the zeros they would otherwise show.
  const ctx = gate.gitDark
    ? `since last-reviewed ${lr}: new-infra UNMEASURED, ${lessonStr}, meta-commits UNMEASURED — every count here is a git read and git is failing`
    : `since last-reviewed ${lr}: ${infra} new infra file(s) (${nSkill} skill/${nHook} hook/${nRule} rule/${nCmd} cmd), ${lessonStr}, ${metaCommits} meta-commits`;
  // ⛔ DARK IS ITS OWN VERDICT AND IS PRINTED WHATEVER ELSE HAPPENS — including alongside DUE, where
  // the infra half alone may have tripped the threshold and a reader would otherwise assume the
  // lessons half was fine. A dark instrument must never be the quiet line in the output.
  const darkLine = !gate.dark
    ? null
    : gate.gitDark
      ? `⛔ INSTRUMENT DARK — NEITHER half of this gate could be measured: ${gate.why}. Treat the whole verdict as UNKNOWN, never as clean.`
      : `⛔ INSTRUMENT DARK — the lessons half of this gate could not be measured: ${gate.why}. Treat the lessons verdict as UNKNOWN, never as clean.`;
  if (due) {
    console.log(`⚠️  CONCEPTUAL PASS DUE — ${ctx}.`);
    console.log(`   → count-syncs keep the NUMBERS fresh but not the lecture PROSE; run a real \`/meta architecture-audit\` (full Tier 2/3), not another count-sync.`);
    console.log(`   (threshold: new-infra ≥ ${T.infra} OR new-lessons ≥ ${T.lessons}; commit-count is context only.)`);
    if (darkLine) console.log(darkLine);
  } else if (gate.dark) {
    console.log(`${darkLine}\n   ${ctx}${gate.gitDark ? "." : ` (infra below threshold ≥ ${T.infra}; lessons gate NOT verified).`}`);
  } else if (lessonDelta === null) {
    // EMPTY: a legitimate absence of anything to compare — no commit before the anchor, or the meta
    // dir did not exist yet at that ref. The canary has already proved git can list, so this is the
    // history, not the instrument. A ✅ here would still be a blind pass, hence PARTIAL.
    // ⛔ THE REASON COMES FROM `classifyLessonsGate`, WHICH NAMES ONLY WHAT WAS ESTABLISHED, and it
    // reaches the output once, inside `ctx`. This branch printed "(git unavailable)" until 2026-09-14
    // while git was plainly working, and the first fix replaced it with a single guess that was wrong
    // for three of four null states.
    console.log(`⚠️  PARTIAL — lessons Δ uncomputable; date-side only — ${ctx} (infra below threshold ≥ ${T.infra}; lessons gate NOT verified).`);
  } else {
    console.log(`✅ conceptual pass OK — ${ctx} (below threshold: infra ≥ ${T.infra} / lessons ≥ ${T.lessons}).`);
  }
  process.exit(0);
}

const docText = readFileSync(DOC_PATH, "utf-8");
const drifts = findDrifts(docText, counts);
const listingFindings = checkListings(docText);
const coverageFindings = checkAppendixCoverage(docText, counts);

// COMPARISON.md banner self-counts live in a SEPARATE file from architecture.md
// (DOC_PATH). Gate them against the same filesystem-derived `counts`. Reuses findDrifts
// (so applyFixes consumes the result unchanged) with the banner-specific pattern set.
const comparisonText = existsSync(COMPARISON_PATH) ? readFileSync(COMPARISON_PATH, "utf-8") : null;
const bannerDrifts = comparisonText ? findDrifts(comparisonText, counts, COMPARISON_BANNER_PATTERNS) : [];

// Narrative-anchor rot (see NARRATIVE_EXPECTED_KEYS): report-only, never auto-fixable —
// the remedy is re-anchoring the matcher (or retiring the expectation), a human edit.
const anchorRot = findAnchorRot(docText);

// Suspect-zero partition (see REGEX_DERIVED): suspect drifts are REPORTED but never WRITTEN.
const suspectDrifts = drifts.filter(isSuspectZero);
const writableDrifts = drifts.filter((d) => !isSuspectZero(d));
const suspectBanner = bannerDrifts.filter(isSuspectZero);
const writableBanner = bannerDrifts.filter((d) => !isSuspectZero(d));

function printCoverage(findings, useStderr) {
  const out = useStderr ? console.error : console.log;
  if (findings.length === 0) return;
  out(`APPENDIX C COVERAGE (${findings.length}):`);
  for (const f of findings) {
    if (f.type === "appx-c-missing") {
      out(`  L# cited in body but missing from Appendix C: ${f.lessons.map((n) => `L${n}`).join(", ")}`);
    } else if (f.type === "appx-c-orphan") {
      out(`  L# in Appendix C but not cited in body: ${f.lessons.map((n) => `L${n}`).join(", ")}`);
    }
  }
  out("");
}

if (cmd === "check") {
  logTelemetry({
    command: "check",
    drift_count: drifts.length,
    banner_drift_count: bannerDrifts.length,
    listing_finding_count: listingFindings.length,
    coverage_finding_count: coverageFindings.length,
    anchor_rot_count: anchorRot.length,
  });
  if (drifts.length === 0 && bannerDrifts.length === 0 && listingFindings.length === 0 && coverageFindings.length === 0 && anchorRot.length === 0) {
    console.log("✅ architecture.md + COMPARISON banner clean — no drift, no listing gaps, Appendix C coverage exact, narrative anchors live");
    process.exit(0);
  }
  console.error("⚠️  doc-count drift detected:");
  console.error("");
  const suspectNote = (d) =>
    isSuspectZero(d)
      ? ` ⚠️ ${d.key}: derived 0 from an existing source — probable regex/header drift, NOT auto-fixable (verify the counter's anchor)`
      : "";
  if (drifts.length > 0) {
    console.error(`COUNT + NARRATIVE DRIFTS (${drifts.length}):`);
    for (const d of drifts) {
      const tol = d.tolerance > 0 ? ` [tolerance ±${d.tolerance}]` : "";
      console.error(`  Line ${d.line}: ${d.label} — claimed ${d.claimed}, actual ${d.actual}${tol}${suspectNote(d)}`);
    }
    console.error("");
  }
  if (bannerDrifts.length > 0) {
    console.error(`COMPARISON.md BANNER DRIFTS (${bannerDrifts.length}):`);
    for (const d of bannerDrifts) {
      const tol = d.tolerance > 0 ? ` [tolerance ±${d.tolerance}]` : "";
      console.error(`  Line ${d.line}: ${d.label} — claimed ${d.claimed}, actual ${d.actual}${tol}${suspectNote(d)}`);
    }
    console.error("");
  }
  if (listingFindings.length > 0) {
    console.error(`LISTING DRIFTS (${listingFindings.length}):`);
    for (const f of listingFindings) {
      if (f.type === "listing-count") {
        console.error(`  ${f.kind}: claimed ${f.claimed}, listed ${f.listed}`);
      } else {
        if (f.missing.length > 0) console.error(`  ${f.kind} MISSING from listing: ${f.missing.join(", ")}`);
        if (f.extra.length > 0) console.error(`  ${f.kind} EXTRA in listing: ${f.extra.join(", ")}`);
      }
    }
    console.error("");
  }
  if (anchorRot.length > 0) {
    console.error(`NARRATIVE ANCHOR ROT (${anchorRot.length}):`);
    for (const k of anchorRot) {
      console.error(
        `  ${k}: every narrative matcher for this key matched ZERO sentences while architecture.md exists — ` +
        `the anchor sentence was likely reworded or removed. Rot here is otherwise SILENT (no match → no drift ` +
        `entry → a stale number is never re-checked). Re-anchor the matcher in PATTERNS, or retire the key from ` +
        `NARRATIVE_EXPECTED_KEYS if the doc deliberately dropped the claim.`
      );
    }
    console.error("");
  }
  printCoverage(coverageFindings, true);
  console.error(`Run 'node scripts/architecture-counts.mjs fix' to apply ≤5-LOC auto-fixes (drift only; listing + coverage + anchor rot surface as proposals).`);
  process.exit(1);
}

if (cmd === "fix") {
  // BLIND≠CLEAN guard: a regex-derived counter reading 0 from an existing source is a
  // broken anchor, not a real count — withhold those writes (warn), fix only the rest.
  const suspectCount = suspectDrifts.length + suspectBanner.length;
  for (const key of new Set([...suspectDrifts, ...suspectBanner].map((d) => d.key))) {
    console.log(`⚠️ ${key}: derived 0 from an existing source — probable regex/header drift, NOT written (verify the counter's anchor)`);
  }
  if (writableDrifts.length === 0 && writableBanner.length === 0) {
    logTelemetry({
      command: "fix",
      drift_count: drifts.length,
      fix_count: 0,
      banner_drift_count: bannerDrifts.length,
      banner_fix_count: 0,
      suspect_zero_count: suspectCount,
      listing_finding_count: listingFindings.length,
      coverage_finding_count: coverageFindings.length,
    });
    console.log(suspectCount > 0
      ? `⚠️ nothing auto-fixed — ${suspectCount} suspect-zero drift(s) withheld`
      : "✅ No drifts to fix");
    if (listingFindings.length > 0) {
      console.log("⚠️  Listing drifts remain (surface as proposals; not auto-fixable):");
      for (const f of listingFindings) {
        if (f.type === "listing-count") {
          console.log(`  ${f.kind}: claimed ${f.claimed}, listed ${f.listed}`);
        } else {
          if (f.missing.length > 0) console.log(`  ${f.kind} MISSING: ${f.missing.join(", ")}`);
          if (f.extra.length > 0) console.log(`  ${f.kind} EXTRA: ${f.extra.join(", ")}`);
        }
      }
    }
    printCoverage(coverageFindings, false);
    process.exit(0);
  }
  let fixCount = 0;
  let bannerFixCount = 0;
  const mutatedPaths = []; // every file this run rewrote, for the stage nudge below
  if (writableDrifts.length > 0) {
    const res = applyFixes(docText, writableDrifts);
    writeFileSync(DOC_PATH, res.updated, "utf-8");
    fixCount = res.fixCount;
    if (res.fixCount > 0) mutatedPaths.push(DOC_PATH);
  }
  if (writableBanner.length > 0 && comparisonText) {
    const res = applyFixes(comparisonText, writableBanner);
    writeFileSync(COMPARISON_PATH, res.updated, "utf-8");
    bannerFixCount = res.fixCount;
    if (res.fixCount > 0) mutatedPaths.push(COMPARISON_PATH);
  }
  logTelemetry({
    command: "fix",
    drift_count: drifts.length,
    fix_count: fixCount,
    banner_drift_count: bannerDrifts.length,
    banner_fix_count: bannerFixCount,
    suspect_zero_count: suspectCount,
    listing_finding_count: listingFindings.length,
    coverage_finding_count: coverageFindings.length,
  });
  console.log(`✅ Applied ${fixCount} auto-fixes to architecture.md${bannerFixCount > 0 ? ` + ${bannerFixCount} to COMPARISON.md banner` : ""}`);
  // An unstaged sentinel write manufactures an orphan no
  // session ever opened — 2026-07-10, five sessions spent an hour hunting the "author" of a
  // dirty COMPARISON.md that THIS script wrote as a /wrap Step 7d side effect. Print each
  // mutated path on its own line so the caller stages exactly these (wrap Step 7d does).
  if (mutatedPaths.length > 0) {
    console.log("Mutated files — now DIRTY in the working tree; STAGE them (an unstaged sentinel write is an orphan for the next session):");
    for (const p of mutatedPaths) console.log(`  ${relative(REPO_ROOT, p)}`);
  }
  if (listingFindings.length > 0) {
    console.log(`⚠️  ${listingFindings.length} listing drifts remain (surface as proposals)`);
  }
  if (coverageFindings.length > 0) {
    console.log(`⚠️  Appendix C coverage findings (surface as proposals):`);
    printCoverage(coverageFindings, false);
  }
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
console.error("Usage: node scripts/architecture-counts.mjs [check|list|fix|--self-test]");
process.exit(2);
