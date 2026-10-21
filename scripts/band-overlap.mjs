#!/usr/bin/env node
/**
 * band-overlap.mjs — the CROSS-BAND OVERLAP INSTRUMENT.
 *
 * Intersects the Evidence-column L-numbers of the two always-loaded bands:
 *   Band-U  .claude/rules/active-recall.md                     (loaded for orchestrator AND every sub-agent)
 *   Band-O  .claude/orchestrator/active-recall-orchestrator.md (hook-injected, ORCHESTRATOR-ONLY)
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT.
 * It is NOT "shrink .claude/rules/ because it is 10x bigger than Band-O" — that is the mass-ratio
 * argument, already REFUTED: Band-O's split was free because those rows were
 * INAPPLICABLE to sub-agents; every byte in rules/ is applicable by construction. The 10x is a
 * ratio of MASS, not of OPPORTUNITY.
 *
 * ⛔ THE OUTPUT IS A CANDIDATE LIST, NEVER A SAVING. A shared L-number is not proof of duplicated
 * CONTENT — the same lesson is legitimately cited for different triggers in the two bands. The
 * finding this instrument delivers is that NOTHING MEASURED THE OVERLAP, not that N rows are waste.
 * Neither existing governor can see it: Band-O's counts CHARS per chunk, Band-U's counts ROWS, and
 * check-band-budget.mjs's bandFiles() never covered .claude/orchestrator/ at all.
 *
 * Read-only. No writes, no network, no side effects.
 *
 * usage:
 *   node scripts/band-overlap.mjs              report
 *   node scripts/band-overlap.mjs --json       machine-readable
 *   node scripts/band-overlap.mjs --self-test  fixtures (exercises the REAL exported symbol)
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BAND_U = ".claude/rules/active-recall.md";
const BAND_O = ".claude/orchestrator/active-recall-orchestrator.md";

/**
 * Extract L-numbers from the EVIDENCE column (last cell) of every markdown table row.
 *
 * Two hazards this is shaped around, both measured on the live bands 2026-08-25:
 *  1. 27 rows carry MULTIPLE L-numbers in one Evidence cell ("L<n> + L<m>") — take ALL, not the first.
 *  2. The trigger/action columns cite L-numbers heavily. A whole-ROW scan over-counts badly, so the
 *     cell must be isolated before matching. This is the instrument's main way of being wrong.
 */
export function evidenceLNumbers(markdown) {
  const out = new Set();
  // ⛔ LOGICAL rows, not physical lines (verified at active-recall.md:76-106):
  // the house style lets one table row span many physical lines — it OPENS on a line starting "|"
  // and CLOSES on the next line ENDING with "|", with plain-prose continuation lines between. The
  // physical-line parser read the opening line's ACTION fragment as the Evidence cell and never saw
  // the true one 30 lines down, silently dropping 4 live L-numbers (published 78; true 82) while
  // the live-corpus control stayed green — it asserts existence, not magnitude.
  const rows = [];
  let buf = null;
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (buf === null) {
      if (!t.startsWith("|")) continue;
      if (/^\|[\s|:-]+\|$/.test(t)) continue; // separator row
      if (t.endsWith("|") && t.length > 1) { rows.push(t); continue; } // ordinary one-line row
      buf = t; continue;                                               // multi-line row opens
    }
    buf += " " + t;
    if (t.endsWith("|")) { rows.push(buf); buf = null; }               // multi-line row closes
  }
  for (const t of rows) {
    const cells = t.split("|");
    // "| a | b | c |".split("|") => ["", " a ", " b ", " c ", ""] — Evidence is the last non-empty.
    let last = "";
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].trim() !== "") { last = cells[i]; break; }
    }
    for (const m of last.matchAll(/\bL(\d+)\b/g)) out.add(Number(m[1]));
  }
  return out;
}

function report(json) {
  const u = evidenceLNumbers(readFileSync(resolve(ROOT, BAND_U), "utf8"));
  const o = evidenceLNumbers(readFileSync(resolve(ROOT, BAND_O), "utf8"));
  const both = [...o].filter((n) => u.has(n)).sort((a, b) => a - b);

  // The split's own header declares the peer-attribution family ORCHESTRATOR-ONLY, so its presence
  // in BOTH bands is the sharpest audit candidate in the set.
  const PEER_FAMILY = [453, 481, 704];
  const peerHits = both.filter((n) => PEER_FAMILY.includes(n));

  if (json) {
    console.log(JSON.stringify({
      bandU: { path: BAND_U, distinct: u.size },
      bandO: { path: BAND_O, distinct: o.size },
      intersection: both,
      peerAttributionFamilyInBoth: peerHits,
      note: "CANDIDATE list, not a saving — a shared L# is not proof of duplicated CONTENT.",
    }, null, 2));
    return 0;
  }

  console.log("band-overlap — Evidence-column L-numbers cited in BOTH always-loaded bands\n");
  console.log(`  Band-U  ${BAND_U}`);
  console.log(`          ${u.size} distinct L-numbers`);
  console.log(`  Band-O  ${BAND_O}`);
  console.log(`          ${o.size} distinct L-numbers\n`);
  console.log(`  IN BOTH: ${both.length}`);
  console.log(`  ${both.map((n) => "L" + n).join(" · ") || "(none)"}\n`);
  if (peerHits.length) {
    console.log(`  ⚠️  SHARPEST CANDIDATES — the peer-attribution family, which Band-O's own header`);
    console.log(`      declares ORCHESTRATOR-ONLY, yet these are cited in BOTH:`);
    console.log(`      ${peerHits.map((n) => "L" + n).join(" · ")}\n`);
  }
  console.log("  ⛔ CANDIDATE LIST, NOT A SAVING. A shared L-number is not proof of duplicated");
  console.log("     CONTENT — the same lesson is legitimately cited for different triggers in the");
  console.log("     two bands. Read each pair before deleting anything. The finding is that nothing");
  console.log("     measured this, not that these rows are waste. (The mass-ratio");
  console.log("     'shrink rules/' argument is already REFUTED — do not re-derive it from this output.)");
  return 0;
}

function selfTest() {
  let fail = 0;
  const check = (name, got, want) => {
    const g = JSON.stringify([...got].sort((a, b) => a - b));
    const w = JSON.stringify([...want].sort((a, b) => a - b));
    if (g === w) { console.log(`  PASS  ${name}`); }
    else { console.log(`  FAIL  ${name}\n        got  ${g}\n        want ${w}`); fail++; }
  };

  // RED CONTROL 1 — the dominant way this instrument can be wrong. An L-number cited in the
  // ACTION column must NOT be counted; only the Evidence cell counts. A whole-row scan passes
  // every other fixture here and fails this one.
  check("action-column L# is NOT counted",
    evidenceLNumbers("| do X per L9 and L8 | then Y | L1 |"), [1]);

  // RED CONTROL 2 — multiple L#s in one Evidence cell (27 live rows have this). Taking only the
  // first match passes fixture 1 and fails this.
  check("multiple L# in one Evidence cell",
    evidenceLNumbers("| trigger | action | L2 + L3 |"), [2, 3]);

  // Evidence cells carry trailing prose in the live bands ("L<n> (default SHIP)").
  check("L# with trailing prose in the cell",
    evidenceLNumbers("| trigger | action | L4 (default SHIP) |"), [4]);

  // Separator and non-table lines contribute nothing.
  check("separator + prose rows ignored",
    evidenceLNumbers("|---|---|---|\nprose mentioning L5\n"), []);

  // Word-boundary: FL7 / L8X are not L-numbers; only the bare L6 is.
  // Distinct numbers per token — with all three sharing one number the Set collapsed them and a
  // boundary-dropping mutant emitted identical bytes (unfalsifiable at birth).
  check("word-boundary respected",
    evidenceLNumbers("| a | b | FL7 and L8X and L6 |"), [6]);

  // RED CONTROL 3 — the multi-line logical row (modeled on active-recall.md:76-106):
  // opens with "|", runs through pipe-free prose lines, closes on a line ending "|" that carries the
  // TRUE Evidence cell. A physical-line parser harvests L9 from the opening fragment and drops L4.
  check("multi-line row: true Evidence cell wins, opening fragment does not",
    evidenceLNumbers("| trigger text mentioning L9 in its action\nplain prose continuation line\nmore prose | L4 · L5 |"), [4, 5]);

  // POSITIVE CONTROL on the live corpus: the intersection must be non-empty and must be a strict
  // subset of BOTH bands. An empty intersection here means the parser broke, not that the bands
  // diverged — the two files have cited overlapping lessons since the 2026-07-12 split.
  const u = evidenceLNumbers(readFileSync(resolve(ROOT, BAND_U), "utf8"));
  const o = evidenceLNumbers(readFileSync(resolve(ROOT, BAND_O), "utf8"));
  const both = [...o].filter((n) => u.has(n));
  if (u.size > 0 && o.size > 0 && both.length > 0 && both.length <= Math.min(u.size, o.size)) {
    console.log(`  PASS  live-corpus control (U=${u.size} O=${o.size} both=${both.length}, all non-zero)`);
  } else {
    console.log(`  FAIL  live-corpus control — U=${u.size} O=${o.size} both=${both.length}; a zero here is the PARSER, not the bands`);
    fail++;
  }

  console.log(fail === 0 ? "\nself-test: OK" : `\nself-test: ${fail} FAILED`);
  return fail === 0 ? 0 : 1;
}

// ⛔ MAIN GUARD — without this, `import`ing the module to reuse evidenceLNumbers() RUNS the CLI
// and prints the whole report as a side effect (measured 2026-08-25: a per-L# loop that imported
// the module re-printed the report on every iteration). The self-test cannot catch this by
// construction — it runs THROUGH the dispatch, so the dispatch is invisible to it.
// POLARITY: this realpathed correctly but fell back to `false` on an unresolvable argv[1]. For a
// gate an undecidable entrypoint must never resolve to "don't run"; the SSOT falls back to the
// naive compare instead. Also drops a dynamic `await import("node:fs")` that existed only to serve
// this guard. SSOT: scripts/lib/is-main.mjs.
if (isMainModule(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--self-test") process.exit(selfTest());
  else if (arg === "--json") process.exit(report(true));
  else if (arg === undefined || arg === "--report") process.exit(report(false));
  else { console.error(`unknown arg: ${arg}\nusage: band-overlap.mjs [--json|--self-test]`); process.exit(2); }
}
