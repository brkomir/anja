#!/usr/bin/env node
/**
 * surface-register-drift — read-only reconciler for `.claude/project-memory/project_surface_audits.md`.
 *
 * WHY THIS EXISTS
 * The register declares: "The S# ROWS below are the source of truth — each carries a
 * `Lenses:` vector. The coverage matrix is a DERIVED/transcribed view. Edit a row's
 * `Lenses:` field, then re-transcribe the matrix cell."
 *
 * Nothing enforced that. On 2026-07-09 a security sweep pointed five surfaces' MATRIX cells
 * at itself but left their row vectors at `·`. That inverts the model: the
 * fresh value lives only in the derived view, and the file's own editing procedure ("edit the
 * row, then re-transcribe") tells the next editor to copy the STALE `·` back over the matrix —
 * silently erasing the record that the sweep ever happened.
 *
 * Four drift classes, all silent to tsc / unit / lint (it's a markdown memory file):
 *   DRIFT                row vector and matrix cell disagree (decide which side is FRESH first: a
 *                        lens-sweep writes MATRIX cells, so there the matrix is fresh — update the
 *                        stale row; blind row-wins re-transcription is the self-erasing trap above)
 *   NO-SSOT              a surface is in the matrix but has NO `Lenses:` vector to derive from
 *   NOT-IN-MATRIX        a surface row exists but never surfaces in the coverage view
 *   STRANDED-BUILD-ITEM  a build-item NAMED in an S# row's Findings / OPEN→BACKLOG note has ZERO
 *                        reference in BACKLOG.md OR todo.txt — the plans→umbrella-row leak. Surface
 *                        panels route open items to an umbrella backlog row; an itemized move
 *                        decays there as prose in one P2 cell, rankable-invisible to `/backlog`.
 *
 * WARN-MODE by default (exit 0) — the baseline is dirty, so a hard gate would fail CI on
 * arrival (warn-before-block: hard-block only when the
 * baseline already passes). `--strict` exits 1; promote to a pre-push/CI gate once clean.
 *
 * ⛔ THE EXIT CODE CARRIES INFORMATION ONLY UNDER `--strict`. In default mode this script exits 0
 * whether or not it found drift, so default mode CANNOT distinguish a working run from a broken
 * one — anything composing on rc must pass --strict, and anything MEASURING this script must
 * measure in --strict.
 *
 * That is not a style note, it is a correction. An earlier commit's body annotated this file
 * "(unaffected; its work is not gated)" while converting its symlink-broken entry guard. The
 * annotation was wrong and wrong for a reason worth keeping: the measurement behind it was taken
 * in DEFAULT mode, where the fixed and the broken program both exit 0. Re-measured at that commit's parent
 * under --strict: real path rc=1, symlinked rc=0, with byte-identical 699-byte output both ways.
 * A drift-detected run read as clean, and nothing in the output differed to say so. The guard is
 * fixed (rc=1 both ways today); only the annotation was false.
 *
 * Sibling of scripts/migration-notation-reconcile.mjs + scripts/memory-config-drift.mjs.
 * Usage: node scripts/surface-register-drift.mjs [--strict] [--self-test]
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { isMain as isMainModule } from "./lib/is-main.mjs";
// Hoisted: BOTH top-level exits need it (the clean-tree one and the tail), and computing it twice
// is how the clean-tree exit got missed the first time.
const IS_MAIN = isMainModule(import.meta.url);

const REGISTER = ".claude/project-memory/project_surface_audits.md";
const LENSES = ["aiqual", "ux", "frontend", "a11y", "copy", "i18n", "perf", "legal", "security", "persona"];

/** Parse the DERIVED matrix: `| S1 /progress | · | ✓ | … |` → 10 cells. */
export function parseMatrix(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const m = /^\|\s*(S\d+)\s[^|]*\|(.+)\|\s*$/.exec(line);
    if (!m || line.includes("Lens")) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length === LENSES.length) out.set(m[1], cells);
  }
  return out;
}

/**
 * Parse the SSOT row vectors. A heading may carry trailing status
 * (`### S24 — /pay · SURFACE · ✓ AUDITED (2026-07-09)`), so anchor on `· SURFACE`, not EOL.
 * A glyph may carry a parenthetical annotation (`legal✓(swept 2026-07-09)`) — strip it.
 */
export function parseRows(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const h = /^###\s+(S\d+)\s+—.*·\s*SURFACE/.exec(line);
    if (h) { current = h[1]; continue; }
    if (line.startsWith("### ")) { current = null; continue; }
    if (!current || !line.trim().startsWith("- **Lenses:**")) continue;

    const body = line.split("**Lenses:**")[1];
    const found = LENSES.map((l) => [body.indexOf(l), l]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
    const vec = {};
    found.forEach(([pos, name], i) => {
      const end = i + 1 < found.length ? found[i + 1][0] : body.length;
      vec[name] = body.slice(pos + name.length, end).replace(/\(.*/s, "").trim();
    });
    out.set(current, vec);
    current = null;
  }
  return out;
}

/**
 * DRIFT CLASS 4 — STRANDED-BUILD-ITEM (2026-07-18). NEW class tracker-coverage-leak
 * (surface-audit panels route open build-items to an umbrella backlog row; the itemized moves
 * decay there invisible to `/backlog`).
 *
 * CONSERVATIVE by construction (warn-mode — a flag is a CANDIDATE to reconcile, never a
 * verdict): split each note on the register's own `·` item separator; DROP any `·`-item carrying a
 * commit SHA or a `plans/…` doc-pointer (that is a provenance / shipped annotation, not a stranded
 * item), or a shipped marker with no residual-open cue; then an item is COVERED if ANY of its
 * distinctive keywords appears ANYWHERE in BACKLOG.md/todo.txt (so an already-reconciled item or one
 * carried into the umbrella row's cell passes). Prefer under-flagging to noise — a keyword-less item (a vague
 * "several open") is skipped, never guessed at.
 */
const LENS_SET = new Set(LENSES);
const STRANDED_SHIPPED = /shipped|fixed|folded|fold-verify|un-scaffold|closed|resolved|\bdone\b|approved|drained|slimmed|verified|deploy-clear|✅/i;
const STRANDED_OPEN_CUE = /\bopen\b|residual|remains|→\s*backlog|open→backlog|\btodo\b/i;
const STRANDED_PROVENANCE = /\b[0-9a-f]{7,40}\b|plans\/|\.md\b|\.json\b/;
// generic process/structural compounds — dropped so an uncovered one can never false-flag
const STRANDED_GENERIC = new Set([
  "deploy-clear", "owner-gated", "owner-ruled", "owner-content", "owner-decidable", "owner-eyes",
  "follow-up", "work-order", "launch-blocker", "launch-critical", "defect-audit", "audit-depth",
  "re-audit", "pre-launch", "post-launch", "in-flight", "cross-cutting", "cross-session", "design-audit",
  "read-only", "build-items", "sub-surface", "first-cohort", "ideation-touched", "non-frozen",
]);

/** Distinctive, matchable keywords from a single build-item phrase (backtick idents, ?params, hyphen-compounds, camelCase, S#/# refs). */
export function buildItemKeywords(item) {
  const kws = new Set();
  for (const m of item.matchAll(/`([^`]+)`/g))
    for (const t of m[1].split(/[^A-Za-z0-9_.?=/-]+/)) {
      const tk = t.replace(/^\.+|\.+$/g, "");
      if (tk.length >= 4 && /[a-z]/i.test(tk) && !/^plans\//.test(tk) && !/\.md$/.test(tk)) kws.add(tk.toLowerCase());
    }
  for (const m of item.matchAll(/\?[a-z][a-z0-9]*=/g)) kws.add(m[0].toLowerCase());
  for (const m of item.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g)) if (m[0].length >= 6) kws.add(m[0].toLowerCase());
  for (const m of item.matchAll(/\b[a-z]+[A-Z][A-Za-z]{2,}\b/g)) kws.add(m[0].toLowerCase());
  for (const m of item.matchAll(/\bS\d+-[A-Z][A-Z0-9-]+\b/g)) kws.add(m[0].toLowerCase());
  for (const m of item.matchAll(/#(\d+)\b/g)) kws.add("#" + m[1]);
  for (const k of [...kws]) if (/^[0-9a-f]{7,40}$/.test(k) || LENS_SET.has(k) || STRANDED_GENERIC.has(k)) kws.delete(k);
  return [...kws];
}

/** Candidate build-items (·-split, provenance/shipped-filtered, keyword-bearing) from every S# row's Findings/OPEN→BACKLOG/Build-items notes. */
export function parseBuildItems(text) {
  const out = [];
  let sid = null;
  for (const line of text.split("\n")) {
    const h = /^###\s+(S\d+)\s+—/.exec(line);
    if (h) { sid = h[1]; continue; }
    if (line.startsWith("### ")) { sid = null; continue; }
    if (!sid) continue;
    const notes = [];
    let m;
    if ((m = /\*\*Findings:\*\*(.+?)(?=\*\*[A-Z]|$)/.exec(line))) notes.push(m[1]);
    if ((m = /OPEN→BACKLOG:(.+?)(?=\*\*[A-Z]|$)/.exec(line))) notes.push(m[1]);
    if ((m = /\*\*Build-items:\*\*(.+?)(?=\*\*[A-Z]|$)/.exec(line))) notes.push(m[1]);
    for (const note of notes)
      for (const raw of note.split("·")) {
        const item = raw.trim();
        if (!item || STRANDED_PROVENANCE.test(item)) continue;
        if (STRANDED_SHIPPED.test(item) && !STRANDED_OPEN_CUE.test(item)) continue;
        const keywords = buildItemKeywords(item);
        if (keywords.length) out.push({ sid, item, keywords });
      }
  }
  return out;
}

// READY-TO-WIRE: class 4 can run at /orient step 5 beside the existing drift check — HOLD for a
// separate SC-3 warn-mode observation window before wiring (this is the add-before-validate gate).

/**
 * @param {string} text  the register markdown
 * @param {{backlog:string,todo:string}} [corpus]  lower-cased BACKLOG.md + todo.txt — required to
 *   run the STRANDED-BUILD-ITEM class; omit it and only classes 1-3 run (keeps selfTest hermetic).
 */
export function reconcile(text, corpus) {
  const matrix = parseMatrix(text);
  const rows = parseRows(text);
  const findings = [];
  for (const [sid, cells] of [...matrix].sort((a, b) => +a[0].slice(1) - +b[0].slice(1))) {
    const vec = rows.get(sid);
    if (!vec) { findings.push({ kind: "NO-SSOT", sid, detail: "in matrix, no `Lenses:` row vector to derive from" }); continue; }
    LENSES.forEach((lens, i) => {
      const rowVal = vec[lens] ?? "<missing>";
      if (rowVal !== cells[i]) findings.push({ kind: "DRIFT", sid, lens, row: rowVal, matrix: cells[i] });
    });
  }
  for (const sid of rows.keys()) {
    if (!matrix.has(sid)) findings.push({ kind: "NOT-IN-MATRIX", sid, detail: "row vector exists, absent from the coverage matrix" });
  }
  // Class 4 — stranded build-items (needs the BACKLOG/todo coverage corpus).
  if (corpus) {
    for (const { sid, item, keywords } of parseBuildItems(text)) {
      const covered = keywords.some((k) => corpus.backlog.includes(k) || corpus.todo.includes(k));
      if (!covered) findings.push({ kind: "STRANDED-BUILD-ITEM", sid, detail: item, keywords });
    }
  }
  return { findings, counts: { matrix: matrix.size, rows: rows.size } };
}

/**
 * Class 4's corpus: BACKLOG.md and todo.txt from the working directory. Both were read unguarded,
 * so a project without one of them threw before any class ran. A missing file is searched as empty;
 * with both missing there is no tracker an item could be stranded from, so the corpus is omitted and
 * class 4 does not run (classes 1-3 still do). `missing` names what was absent, for the run to say.
 */
export function loadCorpus(exists = existsSync, read = (p) => readFileSync(p, "utf8")) {
  const missing = ["BACKLOG.md", "todo.txt"].filter((p) => !exists(p));
  if (missing.length === 2) return { corpus: undefined, missing };
  const get = (p) => (missing.includes(p) ? "" : read(p).toLowerCase());
  return { corpus: { backlog: get("BACKLOG.md"), todo: get("todo.txt") }, missing };
}

function selfTest() {
  const fx = [
    "| Surface \\ Lens | aiqual | ux | frontend | a11y | copy | i18n | perf | legal | security | persona |",
    "| S1 x | · | ✓ | ✓ | ✓ | ✓ | ◐ | →S16 | ✓ | →S23 | ✓ |",
    "| S9 y | · | ✓ | ✓ | ✓ | ✓ | ◐ | →S16 | ✓ | ✓ | ✓ |",
    "",
    "### S1 — x · SURFACE",
    "- **Lenses:** aiqual· ux✓ frontend✓ a11y✓ copy✓ i18n◐ perf→S16 legal✓(note) security· persona✓",
    "### S7 — z · SURFACE · ✓ AUDITED (2026-07-09)",
    "- **Lenses:** aiqual· ux✓ frontend✓ a11y✓ copy✓ i18n◐ perf→S16 legal✓ security✓ persona✓",
    // Class-4 fixture: no matrix cell + no Lenses row, so only STRANDED-BUILD-ITEM inspects it.
    // Three items: a stranded one (0 corpus refs → FLAG), a covered one (in corpus → no flag),
    // a shipped one carrying a SHA (provenance → skipped).
    "### S5 — q · SURFACE",
    "- **Findings:** stranded-widget-thing · covered-gizmo-token · shipped-doodad SHIPPED `abc1234`.",
  ].join("\n");
  const corpus = { backlog: "ranked row mentions covered-gizmo-token here", todo: "" };
  const { findings } = reconcile(fx, corpus);
  const kinds = findings.map((f) => `${f.kind}:${f.sid}${f.lens ? ":" + f.lens : ""}`).sort();
  const want = ["DRIFT:S1:security", "NOT-IN-MATRIX:S7", "NO-SSOT:S9", "STRANDED-BUILD-ITEM:S5"].sort();
  // loadCorpus: neither tracker ⇒ no corpus (class 4 skipped, no throw); one tracker ⇒ the other
  // is searched as empty; both ⇒ both read, lower-cased.
  const fs = (have) => [(p) => have.includes(p), (p) => `${p.toUpperCase()} TEXT`];
  const none = loadCorpus(...fs([]));
  const onlyTodo = loadCorpus(...fs(["todo.txt"]));
  const both = loadCorpus(...fs(["BACKLOG.md", "todo.txt"]));
  const loadOk = none.corpus === undefined && none.missing.join() === "BACKLOG.md,todo.txt"
    && onlyTodo.corpus.backlog === "" && onlyTodo.corpus.todo === "todo.txt text" && onlyTodo.missing.join() === "BACKLOG.md"
    && both.corpus.backlog === "backlog.md text" && both.corpus.todo === "todo.txt text" && both.missing.length === 0
    && reconcile(fx, none.corpus).findings.every((f) => f.kind !== "STRANDED-BUILD-ITEM");
  const ok = JSON.stringify(kinds) === JSON.stringify(want) && loadOk;
  console.log(ok ? "✓ self-test PASS (drift + no-ssot + not-in-matrix + stranded-build-item; annotation stripped; trailing-status heading parsed; covered/shipped items not stranded; missing trackers searched as empty, both missing skips class 4)" : `✗ self-test FAIL\n  got:  ${JSON.stringify(kinds)}\n  want: ${JSON.stringify(want)}\n  loadCorpus arms: ${loadOk ? "ok" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) selfTest();

const { corpus, missing } = loadCorpus();
if (missing.length) {
  console.log(`note: ${missing.join(" and ")} not found in the working directory — ` +
    (corpus ? "searched as empty for the stranded-build-item check" : "the stranded-build-item check did not run"));
}
const { findings, counts } = reconcile(readFileSync(REGISTER, "utf8"), corpus);
// ⛔ SECOND unguarded top-level exit, found when a review claimed `--strict` exits 1 on a clean
// tree. That claim is REFUTED — this branch exits 0 first — but it exposed the sharper defect:
// this exit is ALSO outside the isMain guard, so the import-safety fix below held only WHILE
// findings existed. Both the author and the reviewer measured SURVIVED-IMPORT and both readings
// were an artifact of the tree having 5 findings at the time. A clean tree would have killed the
// importer here, silently, at rc=0 — the exact shape the guard was added to close.
if (!findings.length) {
  console.log(`✓ surface-register-drift: rows ↔ matrix agree${corpus ? " + no stranded build-items" : " (stranded-build-item check not run)"} (${counts.rows} row vectors / ${counts.matrix} matrix surfaces)`);
  if (IS_MAIN) process.exit(0);
}

// The CLI exits above; an IMPORTER falls through the (empty) findings loop below and reaches the
// guarded tail. DECLARED PARTIAL: it sees one extra "0 finding(s)" log line on a clean tree.
// That is noise, not death, and closing it needs the ~110-line body wrap, which is filed
// separately.
console.log(`surface-register-drift — ${findings.length} finding(s) · ${counts.rows} row vectors / ${counts.matrix} matrix surfaces\n`);
for (const f of findings) {
  if (f.kind === "DRIFT") console.log(`  ✗ DRIFT               ${f.sid.padEnd(4)} ${f.lens.padEnd(9)} row(SSOT)=${JSON.stringify(f.row).padEnd(12)} matrix=${JSON.stringify(f.matrix)}`);
  else if (f.kind === "STRANDED-BUILD-ITEM") console.log(`  ⚠️  STRANDED-BUILD-ITEM ${f.sid.padEnd(4)} [${f.keywords.join(", ")}]\n                          ${f.detail.length > 96 ? f.detail.slice(0, 96) + "…" : f.detail}`);
  else console.log(`  ⚠️  ${f.kind.padEnd(19)} ${f.sid.padEnd(4)} ${f.detail}`);
}
if (findings.some((f) => f.kind === "DRIFT" || f.kind === "NO-SSOT" || f.kind === "NOT-IN-MATRIX"))
  console.log(`\nThe ROW is the source of truth — but check which side is actually FRESH before\ntranscribing: a sweep that updated only the matrix leaves the row stale, and blindly\n"re-transcribing the matrix from the row" then erases the sweep record.`);
if (findings.some((f) => f.kind === "STRANDED-BUILD-ITEM"))
  console.log(`\nSTRANDED-BUILD-ITEM = warn-mode CANDIDATES, never a verdict: an open build-item named in an S#\nrow whose distinctive keyword has 0 hit in BACKLOG.md/todo.txt — the plans→umbrella-row leak.\nReconcile each: promote to a ranked BACKLOG row / a todo line with a trigger, OR (if it is already\ntracked under other wording) leave it. Under-flags by design — NOT an exhaustive leak inventory.`);
// ⛔ GUARDED: a bare top-level `process.exit()` fires during `import`, so an importer of the
// five exports above DIES MID-IMPORT — and because this exits 0 without --strict, it dies
// SILENTLY at rc=0, which reads as a clean measurement rather than a break.
// Measured 2026-08-19: a probe importing this file never reached its own next line.
// PARTIAL FIX, stated as such — the module body above still executes on import (file reads +
// console output). Wrapping it needs a re-indent of ~50 lines and is filed, not done here;
// this closes the silent-death half only.
if (IS_MAIN) process.exit(argv.includes("--strict") ? 1 : 0);
