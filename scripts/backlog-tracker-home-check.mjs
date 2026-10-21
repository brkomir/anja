#!/usr/bin/env node
// backlog-tracker-home-check.mjs — the audit-tracker-home gate, as CODE.
//
// WHY THIS EXISTS. The backlog spec says every ranked BACKLOG entry must point at an audit-tracker home,
// because /audit-check writes its result to the audited Flow/F/OPS/S row — an entry with no home
// has nowhere for that result to land, and the gap only ever shows up as an absence.
//
// The gate was PROSE-ONLY until 2026-08-25. Measured that day: `grep -rlF 'Tracked under'
// scripts/ .claude/hooks/ tests/` returned 0, as did `NEW F# proposed`, against a positive control
// showing the literals live in the backlog. So every run rebuilt the regex by hand, and the
// predicate drifted from practice in BOTH directions at once — false alarms on 6 entries that
// carried a real home in an unrecognised form, and real silence on 16 that had none.
//
// ⛔ THE TRAP THIS SCRIPT EXISTS TO END, and it is not the obvious one. The spec's predicate says
// "after stripping `*`". A hand-built regex that forgets that step reports `**Parent capability:**
// F28` as UNHOMED — a false alarm on precisely the entries whose authors took the trouble to mark
// them. Measured the same day, on a hand-built scan, by the author of the row about the drift.
//
// SECOND JOB, which no hand grep ever did: a `NEW <slot> proposed:` marker SATISFIES the gate and
// then nothing ever fires it again, so a proposed slot is a silent never. Four sat in the backlog
// when this was written. This reports them separately — satisfied, but outstanding.
//
// Usage:
//   node scripts/backlog-tracker-home-check.mjs            scan; rc=1 if any ranked entry is unhomed
//   node scripts/backlog-tracker-home-check.mjs --strict    also rc=1 if any NEW-slot proposal is outstanding
//   node scripts/backlog-tracker-home-check.mjs --self-test run the fixtures; rc=1 on any failure
//   node scripts/backlog-tracker-home-check.mjs --file <p>  scan a different file (fixtures/tests)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── THE PREDICATE — the single source of truth. `.claude/skills/backlog/SKILL.md` § Validation
// documents these same forms in prose; the spec says "they move together or neither", so a change
// here needs the prose changed in the same commit.
const HOME_FORMS = [
  "→ Tracked under ",
  "→ Belongs inside ",
  "→ Tracked in full: ",
  "→ Straddles ",
  "→ Full register: ",
  "Tracker-home: ",
  "Parent capability: ",
];
const BARE_ARROW = /→ ?(?:Flow #\d|F\d|S\d|O\d|OPS ?#?\d|AQ\b)/;
const NEW_SLOT = /NEW (?:Flow ?#?|F|OPS ?#?|S)[0-9#\s]*[^\n]{0,60}?proposed:/;

/** Strip markdown emphasis before matching — the spec's own instruction, and the step a
 *  hand-built regex forgets. Without it `**Parent capability:**` never matches. */
export function normalize(text) {
  return String(text).replace(/\*/g, "");
}

export function hasHome(entryText) {
  const t = normalize(entryText);
  return HOME_FORMS.some((f) => t.includes(f)) || BARE_ARROW.test(t) || NEW_SLOT.test(t);
}

export function hasOutstandingProposal(entryText) {
  return NEW_SLOT.test(normalize(entryText));
}

/** Split a BACKLOG-shaped document into ranked entries.
 *  Two entry SHAPES, both governed by the gate:
 *    · a heading entry  `### 12. Title`  — its body runs to the next `###`/`##`
 *    · a compact row    `- **#72 Title** — …` — a single line, used by the triage batches
 *  A range-container heading (`### 72–101.`) is NOT itself an entry: its rows carry the homes.
 *  Only sections under a `## P…` heading are ranked; Archive and Ideas are out of scope. */
export function parseEntries(src) {
  const lines = String(src).split("\n");
  const entries = [];
  let h2 = null;
  let cur = null;
  const flush = () => {
    if (cur) entries.push({ ...cur, text: cur.body.join("\n") });
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      flush();
      h2 = line.trim();
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      const m = /^### (\d+)(?:[–\-—]\d+)?\./.exec(line);
      const isRange = /^### \d+[–\-—]\d+\./.test(line);
      if (m && !isRange && h2 && h2.startsWith("## P")) {
        cur = { kind: "heading", id: Number(m[1]), line: i + 1, title: line.trim().slice(0, 70), body: [line] };
      }
      continue;
    }
    const row = /^- \*\*#(\d+) (.{0,60})/.exec(line);
    if (row && h2 && h2.startsWith("## P")) {
      flush();
      entries.push({
        kind: "row",
        id: Number(row[1]),
        line: i + 1,
        title: `#${row[1]} ${row[2].trim()}`,
        text: line,
      });
      continue;
    }
    if (cur) cur.body.push(line);
  }
  flush();
  return entries;
}

export function scan(src) {
  const entries = parseEntries(src);
  const unhomed = entries.filter((e) => !hasHome(e.text));
  const proposals = entries.filter((e) => hasOutstandingProposal(e.text));
  return { entries, unhomed, proposals };
}

// ───────────────────────────── self-test ─────────────────────────────
// One RED control per claim class. A fixture that only ever PASSES proves nothing: each block
// below asserts BOTH directions, so deleting the predicate makes the suite fail rather than
// silently agree.
function selfTest() {
  let fails = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) fails++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  };

  // CLAIM 1: a homed entry is not flagged — one fixture per documented form.
  for (const form of [
    "→ Tracked under Flow #12", "→ Belongs inside F3", "→ Tracked in full: plans/x.md",
    "→ Straddles Flow #18 + Flow #10", "→ Full register: plans/y.md",
    "Tracker-home: todo.txt", "Parent capability: F28",
    "→ Flow #58", "→ F14", "→ S4", "→ AQ",
  ]) check(`homed: "${form}"`, hasHome(`- **#1 Title** — body. ${form}.`), true);

  // CLAIM 1b — THE REGRESSION GUARD. Asterisk-wrapped must ALSO pass. This is the exact shape a
  // hand-built regex mis-flags, and the reason this file exists rather than another grep.
  check("homed through ** emphasis (the hand-grep false alarm)",
    hasHome("- **Parent capability:** F28 (Viewer-Locale Translation)"), true);

  // CLAIM 2 (RED CONTROL): an entry with no marker IS flagged. Without this the suite would pass
  // over a predicate that returns true for everything.
  check("unhomed: plain prose", hasHome("- **#2 Title** — just a description, no marker."), false);
  check("unhomed: an arrow with no register token", hasHome("- **#3 T** — → 17 rows across trackers."), false);
  check("unhomed: prose mentioning a flow without the arrow", hasHome("- **#4 T** — see Flow #12 for context."), false);

  // CLAIM 3: a NEW-slot proposal satisfies the gate AND is reported outstanding.
  const prop = "- **#5 T** — new capability. NEW F# proposed: pre-shot coaching.";
  check("proposal satisfies the gate", hasHome(prop), true);
  check("proposal reported outstanding", hasOutstandingProposal(prop), true);
  check("a homed entry is NOT reported outstanding (RED control)",
    hasOutstandingProposal("- **#6 T** — body. → F14."), false);

  // CLAIM 4: scoping. Archive is out; range containers are not entries; rows under P tiers are in.
  const doc = [
    "## P2 — Trigger-gated",
    "### 10. A ranked heading with no home",
    "body line",
    "### 72–101. Triage-sweep promotions",
    "- **#72 Homed row** — body. → Flow #58.",
    "- **#73 Unhomed row** — body with nothing.",
    "## Archive (shipped or dropped)",
    "### 99. An archived heading with no home",
    "- **#98 An archived row** — nothing here either.",
  ].join("\n");
  const r = scan(doc);
  check("scoped: 3 ranked entries found (heading + 2 rows; range container excluded)",
    r.entries.map((e) => e.id).sort((a, b) => a - b), [10, 72, 73]);
  check("scoped: archive entries excluded", r.entries.some((e) => e.id === 99 || e.id === 98), false);
  check("scoped: exactly the 2 unhomed ranked entries flagged",
    r.unhomed.map((e) => e.id).sort((a, b) => a - b), [10, 73]);

  // CLAIM 5 (MALFORMED ARGS): an empty or garbage document must not report "clean". A predicate
  // that returns 0 findings on nothing is indistinguishable from one that works.
  check("malformed: empty doc yields zero ENTRIES (not zero findings over a real corpus)",
    scan("").entries.length, 0);
  check("malformed: a doc with no P-section yields zero entries",
    scan("## Archive\n- **#1 x** — y.").entries.length, 0);

  console.log(`\n  self-test: ${fails === 0 ? "ALL PASS" : `${fails} FAILED`}`);
  return fails === 0 ? 0 : 1;
}

// ───────────────────────────── main ─────────────────────────────
function main(argv) {
  if (argv.includes("--self-test")) return selfTest();

  const fi = argv.indexOf("--file");
  const target = fi >= 0 && argv[fi + 1] ? argv[fi + 1] : join(REPO_ROOT, "BACKLOG.md");
  if (!existsSync(target)) {
    console.error(`backlog-tracker-home-check: ${target} does not exist`);
    return 2;
  }
  const { entries, unhomed, proposals } = scan(readFileSync(target, "utf8"));

  // ⛔ A BARE INVOCATION MUST NEVER EXIT 0 VACUOUSLY. Zero ranked entries means the parser
  // failed or the file moved — never "the corpus is clean" — so it is an ERROR, not a pass.
  if (entries.length === 0) {
    console.error(`backlog-tracker-home-check: parsed ZERO ranked entries from ${target}. ` +
      `That is a broken instrument, not a clean corpus — check the '## P…' section headings.`);
    return 2;
  }

  console.log(`tracker-home gate — ${entries.length} ranked entries in ${target}`);
  if (unhomed.length === 0) {
    console.log(`  UNHOMED: 0  ✅`);
  } else {
    console.log(`  UNHOMED: ${unhomed.length}  ❌`);
    for (const e of unhomed) console.log(`    L${e.line}  ${e.title}`);
  }
  console.log(`  OUTSTANDING NEW-SLOT PROPOSALS: ${proposals.length}` +
    (proposals.length ? "  (gate-satisfying, but nothing else will ever surface them)" : ""));
  for (const e of proposals) console.log(`    L${e.line}  ${e.title}`);

  // A positive VERDICT TOKEN, so a composing gate cannot certify a usage message.
  const bad = unhomed.length > 0 || (argv.includes("--strict") && proposals.length > 0);
  console.log(bad ? "TRACKER-HOME-GATE: FAIL" : "TRACKER-HOME-GATE: PASS");
  return bad ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
