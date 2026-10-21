#!/usr/bin/env node
/**
 * watch-tier-retire-sweep.mjs — the READER the `retire-if:` field never had.
 *
 * WHY THIS EXISTS. Every row in the WATCH-TIER register carries its own `retire-if:` date and
 * NOTHING read the field: 289 producers, zero consumers (measured 2026-09-13 — the only hits
 * across scripts/, .claude/hooks/, .githooks/ and .claude/commands/ were three comments in
 * memory-tier-split.mjs about not cutting mid-row, with `AGE RULE` as the positive control
 * returning real surfaces). Meanwhile the AGE RULE's other branch — occurrences 1 AND past the
 * 60-day horizon AND no `retire-if` of its own — became UNREACHABLE the moment every row gained
 * a date, because its third conjunct is now false for every row, permanently. So the surface
 * that tells an operator to "run the AGE RULE curation pass" routed them at a predicate that
 * returns ZERO: a permanent alarm whose prescribed remedy is a verified no-op, which is the
 * shape a review rejected and which was restored by a different route.
 *
 * ⛔ THE SELECTOR IS THE WHOLE DESIGN, AND IT IS DERIVED FROM GROUND TRUTH, NOT FROM THE RULE TEXT.
 * Enumerating every bullet line in the live register (2026-09-13) gives FOUR classes, not two:
 *     277  bold head + occurrences: + retire-if: + first-seen   — the conforming majority
 *      12  bold head + retire-if:, NO `occurrences:` field      — a batch filed under a session
 *                                                                 heading ("first-seen inherited")
 *       7  NO bold head, has occurrences:, no retire-if         — legacy-format entries
 *       1  none of the four                                     — a `✅ PROMOTED` marker
 * A `^- \*\*` anchor sees 289 of 297 and an `occurrences:` anchor sees 284 — NEITHER is complete,
 * and the second is the one a tracker row originally prescribed. Anchor on `^- ` and classify.
 *
 * ⛔ AN ABSENT `occurrences:` IS *UNDETERMINED*, NEVER AN IMPLIED 1. The register's normal
 * convention carries the field; those 12 omit it, and what an absence MEANS is documented
 * nowhere. Reading it as 1 would make them retirable; reading it as unknown holds them. This
 * tool HOLDS them and SAYS SO, because the expensive direction here is measured: a four-seat
 * panel refused an age sweep over precisely the hazard of falsely retiring promote-due rows, and
 * a row one occurrence from promotion is not recoverable by noticing later. They are REPORTED,
 * never silently skipped — a silently-skipped population is how the defect above got shipped.
 *
 * ⛔ AND IT REPORTS THE ROWS WITH NO `retire-if:` AT ALL, which is not bookkeeping. Those are
 * reachable only by the age branch, and the archive's REVIVAL RULE says nothing about the field —
 * it prescribes `occurrences:` INCREMENTED and `first-seen` UNCHANGED and is silent on the date —
 * so every revival re-introduces an unstamped row and silently breaks the every-row-carries-a-date
 * invariant with no gate. This count is that gate.
 *
 * USAGE
 *   node scripts/watch-tier-retire-sweep.mjs              # CHECK (read-only). The default.
 *   node scripts/watch-tier-retire-sweep.mjs --apply      # move DUE rows to the archive; exit 3 on a dirty register
 *       [--allow-dirty <file>[,<file>]]                   # exact basenames of YOUR dirty register files; bare = exit 2
 *   node scripts/watch-tier-retire-sweep.mjs --self-test  # arms, incl. controls that must read the other way
 *
 * ⛔ AFTER `--apply`, RE-ROLL: `node scripts/memory-tier-split.mjs --roll .claude/skills/meta --force`.
 * The register is SHARDED and the splitter re-packs part boundaries greedily over the whole corpus,
 * so removing rows re-flows every boundary downstream and leaves the router's digest stale.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REG_DIR = ".claude/skills/meta";
const ARCHIVE = path.join(REG_DIR, "WATCH-TIER-ARCHIVE.md");

/** Live register parts, router first. ARCHIVE is history and is never a source. */
function registerFiles() {
  return fs
    .readdirSync(REG_DIR)
    .filter((f) => /^WATCH-TIER(-PART-\d+)?\.md$/.test(f))
    .sort((a, b) => (a === "WATCH-TIER.md" ? -1 : b === "WATCH-TIER.md" ? 1 : a.localeCompare(b)))
    .map((f) => path.join(REG_DIR, f));
}

/**
 * A row is a `^- ` line PLUS its continuation lines. Rows DO span lines here (measured: 5 across
 * the register — an indented nested bullet in PART-02 and four `**OCC-N …` lines in the router),
 * and memory-tier-split.mjs refuses to cut inside one for the same reason: a mid-row cut strands
 * the `occurrences:` / `retire-if:` tail in another file, where every field predicate misses it.
 */
function parseRows(text) {
  const lines = text.split("\n");
  const rows = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("- ")) {
      if (cur) rows.push(cur);
      cur = { start: i, end: i, lines: [l] };
    } else if (cur && /^\s/.test(l) && l.trim() !== "" && !l.trimStart().startsWith("<!--")) {
      // INDENTED only: a column-0 paragraph after a row is register prose, not a tail (the
      // 2026-10-09 drain archived the promote-gate convention paragraph as a row's tail).
      cur.lines.push(l);
      cur.end = i;
    } else if (cur) {
      rows.push(cur);
      cur = null;
    }
  }
  if (cur) rows.push(cur);
  return rows.map((r) => ({ ...r, text: r.lines.join("\n") }));
}

/** ISO date inside the row's `retire-if:` field, or null. Keyed on the FIELD, never on a bare date —
 *  a row body routinely carries other dates (first-seen, an OCC-N annotation, a cited incident). */
function retireIfDate(rowText) {
  const m = /retire-if:[^|\n]*?(\d{4})-(\d{2})-(\d{2})/.exec(rowText);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Explicit `occurrences: N`, or null when the field is ABSENT (undetermined — never assumed 1). */
function occurrences(rowText) {
  const m = /occurrences:\s*(\d+)/.exec(rowText);
  // The dated OCC-N annotation is the SSOT and the header count a denormalization (register
  // convention): a header left at 1 under an OCC-2 tail is a promote-due row.
  const ann = [...rowText.matchAll(/\bOCC-(\d+)\b/g)].map((x) => +x[1]);
  if (!m && !ann.length) return null;
  return Math.max(m ? +m[1] : 0, ...ann);
}

function shortName(rowText) {
  const first = rowText.split("\n")[0];
  const bold = /^-\s+\*\*(.+?)\*\*/.exec(first);
  const label = bold ? bold[1] : first.replace(/^-\s+/, "");
  return label.length > 96 ? label.slice(0, 93) + "..." : label;
}

/** A row that records its own promotion (the house marker is the upper-case word PROMOTED, as in
 * "✅ PROMOTED 2026-09-12 → L<n>" or "PROMOTED to L<n>") is a lesson already, so it must never be
 * archived as "no recurrence". It belongs off the live register. Measured 2026-10-11: four such rows
 * were still live, two of them carrying a retire-if date and an occurrence count the case-sensitive
 * OCC-N reader saw as 1 (their second sighting was written "occ-2"), so the sweep would have stamped
 * them "no recurrence" on 2026-10-31 and 2026-11-21. */
function promotedRecord(rowText) {
  // The MARKER, not the word: PROMOTED followed by a date, an arrow, to/into/as/earlier, BY EXTENSION
  // or "— CLOSED" (42 of the archive's 43 PROMOTED-bearing rows; the 43rd is PARTIALLY PROMOTED, whose
  // unpromoted half stays live). Bare \bPROMOTED\b also matched the emphatic past-tense verb this
  // corpus writes in caps ("a 46-day recurrence ... was PROMOTED", WATCH-TIER.md's own header).
  return /(?<!PARTIALLY )\bPROMOTED\b(?=[\s*~)\]]*(?:\d{4}-\d{2}-\d{2}|to\b|→|->|into\b|as\b|BY EXTENSION|earlier|—\s*CLOSED|\())/.test(rowText);
}

/** Which bucket one row lands in. Pure, so the self-test exercises the SAME decision the sweep
 * makes — the promoted check sat inline in classify() at first, and deleting it left every arm green. */
/** occurrences >= 2: owed a promotion, never retired. One spelling for the bucket, the list and the projection. */
const promoteDueCount = (occ) => occ !== null && occ >= 2;

function bucketOf(rowText, today) {
  if (promotedRecord(rowText)) return "promoted";
  const d = retireIfDate(rowText);
  if (!d) return "noDate";
  if (d >= today) return "notYet";
  const occ = occurrences(rowText);
  if (occ === null) return "undetermined";
  if (promoteDueCount(occ)) return "promoteDue";
  return "due";
}

function classify(today) {
  const out = { due: [], promoteDue: [], undetermined: [], noDate: [], notYet: [], promoted: [], total: 0 };
  for (const file of registerFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const row of parseRows(text)) {
      out.total++;
      const rec = { file, row, name: shortName(row.text) };
      const b = bucketOf(row.text, today);
      const d = retireIfDate(row.text);
      if (d) rec.date = d.toISOString().slice(0, 10);
      if (b === "due") rec.occ = occurrences(row.text);
      out[b].push(rec);
    }
  }
  return out;
}

function report(c, today) {
  const iso = today.toISOString().slice(0, 10);
  console.log(`WATCH-TIER retire-if sweep — ${iso}`);
  console.log(`  register rows across ${registerFiles().length} files: ${c.total}`);
  console.log("");
  console.log(`  DUE NOW        — date passed, occurrences: 1     ${c.due.length}`);
  console.log(`  HELD           — promote-due (occurrences >= 2)  ${c.promoteDue.length}`);
  console.log(`  HELD           — occurrences ABSENT, UNDETERMINED ${c.undetermined.length}`);
  console.log(`  not yet due                                      ${c.notYet.length}`);
  console.log(`  no retire-if at all (age-branch only)            ${c.noDate.length}`);
  console.log(`  PROMOTED — already a lesson, never retired        ${c.promoted.length}`);
  if (c.promoted.length) {
    console.log("\n  ⛔ PROMOTED rows still on the live register — move each to WATCH-TIER-ARCHIVE.md as a");
    console.log("     promoted record (`/meta learn` watch-tier step 2 says a promoted row is DELETED from the register):");
    for (const r of c.promoted) console.log(`    ${path.basename(r.file)}  ${r.name}`);
  }
  if (c.due.length) {
    console.log("\n  DUE NOW:");
    for (const r of c.due) console.log(`    ${r.date}  ${path.basename(r.file)}  ${r.name}`);
  }
  // The HELD count above is only the rows whose date has PASSED; a row reaches occurrences >= 2 and
  // stays unpromoted at any date, so the per-row disposition `/meta learn` step 3 owes reads THIS list.
  const pd = [...c.promoteDue, ...c.notYet, ...c.noDate].filter((r) => promoteDueCount(occurrences(r.row.text)));
  console.log(`\n  PROMOTE-DUE — occurrences >= 2 at any date (each owed a promotion by step 2): ${pd.length}`);
  for (const r of pd) console.log(`    ${r.date ?? "no date   "}  ${path.basename(r.file)}  L${r.row.start + 1}  ${r.name}`);
  if (c.undetermined.length) {
    console.log("\n  ⛔ HELD, UNDETERMINED — an absent `occurrences:` is NOT an implied 1, and what an");
    console.log("     absence means is documented nowhere. Held rather than retired because the");
    console.log("     expensive direction is falsely retiring a promote-due row. Give each an explicit");
    console.log("     `occurrences:` to make it decidable:");
    for (const r of c.undetermined) console.log(`    ${r.date}  ${path.basename(r.file)}  ${r.name}`);
  }
  if (c.noDate.length) {
    console.log("\n  ⚠️  NO `retire-if:` — reachable only by the age branch. A revival re-introduces");
    console.log("     these by construction: the REVIVAL RULE prescribes `occurrences:` incremented and");
    console.log("     `first-seen` unchanged, and is SILENT on the date. This count is that gate:");
    for (const r of c.noDate) console.log(`    ${path.basename(r.file)}  ${r.name}`);

    // ⛔ THE UN-RETIRABLE SUBSET, WHICH IS THE ONE THE RETIRE PASS CAN NEVER REACH. A row in this
    // bucket has no parseable `retire-if:`; if it ALSO carries an `occurrences:` count it is not
    // merely age-branch-only, it is permanently un-retirable — the age branch needs occurrences: 1
    // and the date branch needs a date, so a counted row with no date satisfies neither.
    // It lives HERE rather than in --self-test because this is the invocation the repo's only
    // routing pointer names (check-memory-size.sh sends operators to the DEFAULT run) and because
    // --self-test is hermetic by contract: every other arm reads an inline fixture, so a
    // live-corpus assertion there manufactured a warn-vs-hard question that does not exist on this
    // path. It also inherits this bucket's parseable-DATE test for free, where the version in
    // --self-test tested only that the field NAME appeared. This file's own header already
    // designates this path as the gate for this population.
    const unretirable = c.noDate.filter((r) => occurrences(r.row.text) !== null);
    console.log(`\n  ⛔ of those, PERMANENTLY UN-RETIRABLE — a count with no parseable expiry, so`);
    console.log(`     neither branch can ever match them: ${unretirable.length} of ${c.noDate.length}`);
    for (const r of unretirable) {
      console.log(`    ${path.basename(r.file)}  L${r.row.start + 1}  ${r.name}`);
    }
  }
  // \u26d4 THE PROJECTION EXISTS BECAUSE A BARE "DUE WITHIN N DAYS" IS NOT A DRAIN FIGURE, AND
  // READING IT AS ONE IS A MEASURED ERROR OF MINE. I reported 28 due within 7 days against a
  // lens's 26 and attributed the delta to the day boundary; it was not. 28 rows carry a date
  // inside the week and 26 are RETIRABLE \u2014 the other 2 are promote-due and held forever by the
  // occurrences >= 2 branch. The gap was the exclusion this tool exists to apply, explained away
  // with an untested cause. So the tool prints RETIRABLE, never DUE, and prints the held counts
  // beside it so the two can never be conflated again.
  const horizons = [7, 30];
  const all = [...c.due, ...c.promoteDue, ...c.undetermined, ...c.notYet];
  console.log("\n  PROJECTION \u2014 what becomes RETIRABLE without anyone editing a row:");
  for (const h of horizons) {
    // The bucket the sweep would assign on the day AFTER the horizon: a date <= lim has passed by then.
    const after = new Date(today.getTime() + (h + 1) * 86400000);
    let ret = 0, held = 0, und = 0, bytes = 0;
    for (const r of all) {
      const b = bucketOf(r.row.text, after);
      if (b === "undetermined") und++;
      else if (b === "promoteDue") held++;
      else if (b === "due") { ret++; bytes += Buffer.byteLength(r.row.text); }
    }
    console.log(`    within ${String(h).padStart(2)} days:  RETIRABLE ${String(ret).padStart(3)} (${bytes} B)` +
                `   held promote-due ${held}   undetermined ${und}`);
  }
  const live = registerFiles().reduce((n, f) => n + Buffer.byteLength(fs.readFileSync(f, "utf8")), 0);
  console.log(`    live register: ${live} B`);

  console.log("");
  if (c.due.length === 0) {
    console.log("  Nothing due. ⛔ This is a REAL zero over a LIVE predicate, not the unreachable one:");
    console.log(`  ${c.notYet.length} rows carry a future date and will become due without any edit.`);
  } else {
    console.log(`  Apply with: node scripts/watch-tier-retire-sweep.mjs --apply`);
  }
}

/**
 * APPLY — move the DUE rows verbatim, then PROVE it rather than announce it.
 *
 * ⛔ CONSERVATION IS ASSERTED IN THE SAME RUN, and the tool ABORTS rather than writes on a
 * mismatch. Three legs, because each is blind to what the others catch:
 *   (1) every moved row is present in the archive BYTE-IDENTICAL — catches a mangled move;
 *   (2) the live corpus shrinks by EXACTLY the moved bytes plus the newlines removed — catches a
 *       partial cut, and a size-only check would not (a same-length substitution carries zero bits,
 *       so this is paired with (1) rather than trusted alone);
 *   (3) the surviving row multiset equals before-minus-moved, compared by row TEXT — catches a
 *       neighbour destroyed by an off-by-one slice, which (1) and (2) both pass.
 */
/** The register paths a `git status --porcelain` listing reports dirty. `--apply` refuses on any:
 *  the sweep rewrites every live part and the re-roll re-packs
 *  them, so a PEER's uncommitted WATCH-TIER row rides into this seat's write and its commit. The
 *  porcelain prefix is two status columns + a space; `MEMORY.md` and other non-register files in the
 *  same dir are not the hazard and do not count. `--allow-dirty` is the escape, for the seat that
 *  owns the dirt. Pure, so --self-test can feed it fixtures. Input is `--porcelain -z`, the form
 *  memory-tier-split.mjs's roll gate reads: never quoted, and a rename/copy record carries its
 *  ORIGINAL path as the next NUL field, so a register part renamed AWAY is seen too. */
function dirtyRegisterPaths(porcelainZ) {
  const recs = String(porcelainZ).split("\0"), out = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].length <= 3) continue;
    const paths = [recs[i].slice(3)];
    if (/^[RC]|^.[RC]/.test(recs[i])) paths.push(recs[++i] ?? "");
    for (const p of paths) if (path.dirname(p) === REG_DIR && /^WATCH-TIER[^/]*\.md$/.test(path.basename(p))) out.push(p);
  }
  return out;
}
/** `--allow-dirty <name>[,<name>]`, every occurrence; null when one names no file (the caller exits 2).
 *  Scoped like the roll's: a global switch also waves a PEER's dirty part. */
function parseAllowDirty(argv) {
  const allowed = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--allow-dirty") continue;
    const v = argv[i + 1];
    const names = (v && !v.startsWith("--") ? v : "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return null;
    for (const n of names) allowed.add(n);
  }
  return allowed;
}
const blockedPaths = (dirty, allowed) => dirty.filter((p) => !allowed.has(path.basename(p)));
const gitStatusZ = () => execFileSync("git", ["status", "--porcelain", "-z", "--", REG_DIR], { encoding: "utf8" });

function apply(c, today, sid) {
  if (c.due.length === 0) {
    console.log("Nothing due — nothing written.");
    return 0;
  }
  const iso = today.toISOString().slice(0, 10);
  const byFile = new Map();
  for (const r of c.due) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r.row);
  }

  const before = new Map();
  const beforeRows = new Set();
  for (const f of registerFiles()) {
    const t = fs.readFileSync(f, "utf8");
    before.set(f, t);
    for (const row of parseRows(t)) beforeRows.add(row.text);
  }

  // Cut by LINE INDEX, descending, so an earlier removal cannot shift a later row's coordinates.
  const nextLive = new Map();
  for (const [file, rows] of byFile) {
    const lines = before.get(file).split("\n");
    for (const row of [...rows].sort((a, b) => b.start - a.start)) {
      lines.splice(row.start, row.end - row.start + 1);
    }
    nextLive.set(file, lines.join("\n"));
  }

  const block = [
    ``,
    `## RETIRED BY retire-if ${iso} (${sid}) — a sweep that READS the field. Each row below reached its OWN`,
    `\`retire-if:\` date with \`occurrences: 1\`. Rows whose \`occurrences:\` is >= 2 are promote-due and were NOT`,
    `touched; rows carrying NO explicit \`occurrences:\` were HELD as undetermined rather than assumed to be 1.`,
    `Rows are VERBATIM. Revive per the REVIVAL RULE above on any new match — and note that rule is silent on`,
    `\`retire-if:\`, so a revival re-enters WITHOUT a date unless you add one.`,
    ``,
  ];
  for (const r of c.due) {
    block.push(r.row.text);
    block.push(`  retired: ${iso} — retire-if: ${r.date} passed, occurrences ${r.occ}, no recurrence`);
    block.push(``);
  }
  const nextArchive = fs.readFileSync(ARCHIVE, "utf8").replace(/\s*$/, "\n") + block.join("\n");

  // ---- LEG 1: every moved row byte-identical in the new archive text
  for (const r of c.due) {
    if (!nextArchive.includes(r.row.text)) {
      console.error(`⛔ CONSERVATION LEG 1 FAILED — row not byte-identical in the archive:\n   ${r.name}`);
      return 1;
    }
  }
  // ---- LEG 2: live corpus shrinks by exactly the moved bytes (+1 newline per removed line)
  const liveBefore = [...before.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
  const liveAfter = [...registerFiles()].reduce(
    (n, f) => n + Buffer.byteLength(nextLive.has(f) ? nextLive.get(f) : before.get(f)), 0);
  // \u26d4 +1 PER ROW, NOT ONE PER LINE. Splicing a contiguous block of N lines out of an array and
  // re-joining with "\n" removes the block's text plus exactly ONE newline \u2014 the N-1 separators
  // INSIDE the block are already counted in row.text, and only the single separator that joined the
  // block to its neighbour disappears. The first version charged one newline per line and was off by
  // (lines - 1) per row, so it read 183 B against a true 182 on a two-line row and REFUSED. Caught by
  // planting a due row in an isolated copy \u2014 nothing is due in the live register today, so this path
  // had never executed, and a gate that refuses every legitimate move is the mirror of one that passes
  // everything. A single-line row hid it completely: the two formulas agree at N=1.
  const movedBytes = c.due.reduce((n, r) => n + Buffer.byteLength(r.row.text) + 1, 0);
  if (liveBefore - liveAfter !== movedBytes) {
    console.error(`⛔ CONSERVATION LEG 2 FAILED — live shrank by ${liveBefore - liveAfter} B, moved ${movedBytes} B`);
    return 1;
  }
  // ---- LEG 3: surviving row multiset == before minus moved (catches a destroyed NEIGHBOUR)
  const movedSet = new Set(c.due.map((r) => r.row.text));
  const survivors = new Set();
  for (const f of registerFiles()) {
    for (const row of parseRows(nextLive.has(f) ? nextLive.get(f) : before.get(f))) survivors.add(row.text);
  }
  for (const t of beforeRows) {
    if (!movedSet.has(t) && !survivors.has(t)) {
      console.error(`⛔ CONSERVATION LEG 3 FAILED — a row that was NOT moved has vanished:\n   ${shortName(t)}`);
      return 1;
    }
  }

  for (const [f, t] of nextLive) fs.writeFileSync(f, t);
  fs.writeFileSync(ARCHIVE, nextArchive);
  console.log(`Moved ${c.due.length} row(s), ${movedBytes} B, to ${path.basename(ARCHIVE)}.`);
  console.log(`  conservation: 3/3 legs passed (byte-identical · exact shrink · multiset)`);
  console.log(`⛔ NOW RE-ROLL — the register is sharded and part boundaries have moved:`);
  console.log(`   node scripts/memory-tier-split.mjs --roll .claude/skills/meta --force`);
  return 0;
}

/** Self-test. Every arm carries a control that must read the OTHER way; a green that survives the
 *  mutation is a green that proves nothing, which is the defect this whole tool exists downstream of. */
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? "✓" : "✗"} ${name}`); };
  const T = (s) => `- **x** | ${s}`;

  ok("retireIfDate reads the FIELD", retireIfDate(T("retire-if: no recurrence by 2026-01-02")) !== null);
  ok("… and is NOT fooled by another date in the row (control: must be null)",
     retireIfDate(T("first-seen 2026-01-02 | occurrences: 1")) === null);
  ok("occurrences reads an explicit value", occurrences(T("occurrences: 3")) === 3);
  ok("… and returns null when ABSENT, never 1 (control)", occurrences(T("retire-if: by 2026-01-02")) === null);
  ok("an OCC-N annotation outranks a stale header count (the annotation is the SSOT)",
     occurrences(T("occurrences: 1 | retire-if: by 2026-01-02") + "\n  **OCC-2 (sid, 2026-01-01)**") === 2);
  ok("… control: a header-only row keeps its header count", occurrences(T("occurrences: 1")) === 1);
  ok("a row recording its own promotion is a PROMOTED record",
     promotedRecord(T("occurrences: 1 | PROMOTED to L2 2026-10-04 (occ-2: x) | retire-if: no recurrence by 2026-01-02")));
  ok("… control: a live row that only says it will promote at 2 is NOT",
     !promotedRecord(T("occurrences: 1 | Promote at 2: a check | retire-if: no recurrence by 2026-01-02")));
  ok("… control: the emphatic verb (\"a recurrence was PROMOTED; a sweep would have retired it\") is NOT a record",
     !promotedRecord(T("occurrences: 1 | a 46-day recurrence was PROMOTED; a sweep would have retired it | retire-if: no recurrence by 2026-01-02")));
  {
    const t0 = new Date(Date.UTC(2026, 5, 1));
    ok("a PROMOTED row past its retire-if date at occurrences 1 is never DUE (the sweep's own bucket)",
       bucketOf(T("occurrences: 1 | PROMOTED to L2 | retire-if: no recurrence by 2026-01-02"), t0) === "promoted");
    ok("… control: the same row without the marker IS due",
       bucketOf(T("occurrences: 1 | retire-if: no recurrence by 2026-01-02"), t0) === "due");
  }
  ok("… control: a lowercase 'promoted' about a PREDECESSOR in the slot is NOT",
     !promotedRecord(T("occurrences: 1 | retire-if: by 2026-01-02 *(This slot held \"x\" until 2026-10-03: promoted at occurrence 2 to L2.)*")));
  ok("… control: a PROMOTE-CANDIDATE score is NOT", !promotedRecord(T("D+I+S 3+2+2=7 → PROMOTE-CANDIDATE | occurrences: 1")));
  {
    // Every bucket, through bucketOf, with the date boundary: today's own date is NOT yet due.
    const t0 = new Date(Date.UTC(2026, 5, 1));
    for (const [s, want] of [["occurrences: 1 | retire-if: by 2026-05-31", "due"], ["occurrences: 2 | retire-if: by 2026-05-31", "promoteDue"],
      ["retire-if: by 2026-05-31", "undetermined"], ["occurrences: 1 | retire-if: by 2026-06-01", "notYet"], ["occurrences: 1", "noDate"],
      ["occurrences: 1 | PROMOTED to L1 | retire-if: by 2026-12-31", "promoted"], ["occurrences: 1 | PROMOTED to L1", "promoted"]])
      ok(`bucketOf → ${want}: ${s}`, bucketOf(T(s), t0) === want);
  }
  const prose = parseRows("- **a** | occurrences: 1\nConvention paragraph at column 0\n  indented tail");
  ok("a column-0 paragraph after a row is NOT absorbed as its tail", prose.length === 1 && prose[0].lines.length === 1);

  const past = new Date(Date.UTC(2026, 0, 2)), today = new Date(Date.UTC(2026, 5, 1));
  ok("a passed date is in the past", past < today);

  const multi = "- **row a** | occurrences: 1 | retire-if: by 2026-01-02\n  **OCC-2 tail line**\n\n- **row b** | occurrences: 1";
  const rows = parseRows(multi);
  ok("a multi-line row is parsed as ONE row with its tail", rows.length === 2 && rows[0].lines.length === 2);
  ok("… control: the tail is NOT parsed as its own row", !rows.some((r) => r.text.trim() === "**OCC-2 tail line**"));

  const four = parseRows([
    "- **conforming** | occurrences: 1 | retire-if: by 2026-01-02",
    "- **promote-due** | occurrences: 2 | retire-if: by 2026-01-02",
    "- **undetermined** | retire-if: by 2026-01-02",
    "- 2026-08-31 (sid) — legacy, no bold head | occurrences: 1",
  ].join("\n"));
  ok("all FOUR real classes are seen by the ^- anchor", four.length === 4);
  ok("… control: a ^- ** anchor would MISS the legacy row",
     four.filter((r) => r.text.startsWith("- **")).length === 3);
  ok("… control: an occurrences: anchor would MISS the undetermined row",
     four.filter((r) => occurrences(r.text) !== null).length === 3);

  // THE INVARIANT THE RETIRE PASS ACTUALLY NEEDS, CHECKED AGAINST THE LIVE REGISTER RATHER THAN A
  // FIXTURE. A row that declares an occurrence count must also declare when it expires: if the two
  // fields land on DIFFERENT parsed rows the retire pass can never match them, and the row is
  // permanently un-retirable while looking fine to a reader. The synthetic multi-line arm above
  // proves the parser CAN keep a tail; this asks whether the register actually has none split.
  //
  // The classifier fact the report path now prints, asserted HERMETICALLY — inline fixtures, the
  // contract every other arm here keeps. The live-corpus version sat in this function until
  // 2026-09-19 and COULD NOT FAIL: its predicate was never passed to ok(), so five mutations aimed
  // at it (forced true, forced false, wrong field, emptied source, clean synthetic source) all read
  // PASS 12 / FAIL 0 — measured, not argued. Three of those five printed
  // the exact string a tracker row was closing on, so that row was closable by tool rot alone.
  const uRows = parseRows([
    "- **counted, no expiry** | occurrences: 1",
    "- **counted, has expiry** | occurrences: 1 | retire-if: by 2026-01-02",
    "- **uncounted, no expiry** | first-seen 2026-01-01",
  ].join("\n"));
  const noDated = uRows.filter((r) => retireIfDate(r.text) === null);
  ok("a counted row with no parseable expiry is the un-retirable class",
     noDated.filter((r) => occurrences(r.text) !== null).length === 1);
  ok("… control: an UNCOUNTED row with no expiry is NOT in that class (the age branch reaches it)",
     noDated.length === 2);
  ok("… control: a row carrying BOTH lands in neither bucket",
     uRows.filter((r) => retireIfDate(r.text) !== null).length === 1);

  // --apply's dirty-register refusal: the predicate is pure, so it is fed
  // porcelain fixtures here; a register file dirty in either column counts, a sibling MEMORY.md
  // or a stray untracked non-register file does not.
  const Z = (...recs) => recs.join("\0") + "\0", P = `${REG_DIR}/`;
  const porcelain = Z(` M ${P}WATCH-TIER-PART-02.md`, `?? ${P}WATCH-TIER-PART-07.md`, ` M ${P}MEMORY.md`, `?? ${P}notes.txt`);
  const dirty = dirtyRegisterPaths(porcelain);
  ok("dirtyRegisterPaths lists the dirty register files (2 of 4 records)",
     dirty.length === 2 && dirty.includes(`${P}WATCH-TIER-PART-02.md`) && dirty.includes(`${P}WATCH-TIER-PART-07.md`));
  ok("… control: a dirty sibling MEMORY.md does NOT count", !dirty.some((p) => p.endsWith("MEMORY.md")));
  ok("… control: a clean tree yields an empty list", dirtyRegisterPaths("").length === 0);
  ok("a STAGED-only register edit (column 1, worktree column blank) counts",
     dirtyRegisterPaths(Z(`M  ${P}WATCH-TIER.md`)).length === 1);
  ok("the ARCHIVE counts — apply() rewrites it", dirtyRegisterPaths(Z(` M ${P}WATCH-TIER-ARCHIVE.md`)).length === 1);
  ok("a part renamed AWAY counts (its original path is the record's second NUL field)",
     dirtyRegisterPaths(Z(`R  ${P}old.md`, `${P}WATCH-TIER-PART-05.md`)).includes(`${P}WATCH-TIER-PART-05.md`));
  const allowed = parseAllowDirty(["--apply", "--allow-dirty", "WATCH-TIER-PART-02.md"]);
  const blocked = blockedPaths(dirty, allowed);
  ok("--allow-dirty waives ONLY the file it names: the other dirty part still refuses",
     blocked.length === 1 && blocked[0].endsWith("WATCH-TIER-PART-07.md"));
  ok("… control: a bare --allow-dirty names nothing and is rejected", parseAllowDirty(["--apply", "--allow-dirty"]) === null);

  console.log(`\n  PASS: ${pass}\n  FAIL: ${fail}`);
  return fail === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
const today = new Date(Date.UTC(
  new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
if (argv.includes("--self-test")) {
  process.exit(selfTest());
} else if (argv.includes("--apply")) {
  const sid = (process.env.CLAUDE_CODE_SESSION_ID || "unknown").slice(0, 8);
  const allowed = parseAllowDirty(argv);
  if (allowed === null) {
    console.error("--allow-dirty needs one or more register file names (exact basenames), e.g. --allow-dirty WATCH-TIER.md");
    process.exit(2);
  }
  const dirty = blockedPaths(dirtyRegisterPaths(gitStatusZ()), allowed);
  if (dirty.length) {
    console.error(`REFUSED: --apply on a dirty register — ${dirty.length} uncommitted register file(s): ${dirty.join(", ")}.`);
    console.error("  A peer's uncommitted watch-tier row would ride into this write and its commit. Commit or hand back the");
    console.error("  dirt first, or name ONLY your own files: --allow-dirty <file>[,<file>] (exact basenames).");
    process.exit(3);
  }
  const c = classify(today);
  report(c, today);
  console.log("");
  process.exit(apply(c, today, sid));
} else {
  report(classify(today), today);
  // The refusal is previewable HERE, so demonstrating it never needs the writing verb.
  let would;
  try { would = dirtyRegisterPaths(gitStatusZ()); } catch { would = null; }
  if (would === null) console.log("\n  ⚠️  git status failed — --apply would exit non-zero before writing.");
  else if (would.length) console.log(`\n  ⛔ --apply would REFUSE (exit 3) — dirty register file(s): ${would.join(", ")}`);
}
