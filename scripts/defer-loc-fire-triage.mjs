#!/usr/bin/env node
// defer-loc-fire-triage.mjs — measurement instrument for the defer-loc-check
// entry-grammar item (5-lens Fable panel, 2026-07-12). Deterministic, zero-LLM,
// READ-ONLY (writes no logs).
//
// WHY: the queue row "142 latent FPs -> PreToolUse block" carried two false
// numbers (the "142" was a phantom; a "0 fires" reading was a rotation
// trap — 15 real fires exist in the archive log). The panel data-gated the fix
// behind a real measurement of the surface the hook ACTUALLY scans (changed
// regions ~= lines ADDED to todo.txt across git history), not a whole-file scan.
//
// WHAT it reports:
//   (1) REPLAY — over every line added to todo.txt since the hook shipped
//       (2026-06-21), how many fire the CURRENT grammar vs a PROPOSED item-grammar
//       (meta-block-field-aware + the F5 time-estimate fix). The delta = the fix's
//       measured value; the residual = fires the fix does NOT remove.
//   (2) LABEL — correlates the 15 archived real fires to their commits + labels
//       each TP (genuine no-estimate defer) / FP (item carries an estimate).
//   (3) F5 — how many current suppressions rely on a bare "~N" time-estimate
//       (e.g. "~1-2h") that the current LOC regex wrongly accepts as an LOC.
//
// USAGE: node scripts/defer-loc-fire-triage.mjs [--self-test] [--since=YYYY-MM-DD]
//        --self-test runs RED controls (a known FP + TP + F5 fixture) and exits.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { return ""; } };

// ── grammar, ported VERBATIM from .claude/hooks/defer-loc-check.sh (lines 61-122) ──
const DEFER = /post-?launch|revisit( later| when| after)|out[ -]of[ -](today.?s )?scope|tech debt|future[ \w-]*?\b(commit|sweep|pass|audit|candidate)\b|\bdefer(s|ring)?\b|next[ -](session|pass|audit)|watch[ -]?(tier|item)|wait until|wait for .*(complain|signal)|track (after|later)|monitor (and|then|post)|(file[ -])?for[ -]later|not actioned|optional[ \w-]{0,20}(follow-?up|sequenced)|labell?ed? optional|sometime,? not now|separate[ \w-]*?\b(reorg|follow-?up)\b|\b(punt|shelve|deprioriti[sz]e|circle back|hold off)\b|needs (a (design|content|schema|product|re-home) decision|prod(uction)? data)/i;
const LOC_CUR = /[0-9]+\s*LOC|~\s*[0-9]+|[0-9]+\s*lines?/i;                 // current: bare "~N" branch is the F5 bug
const LOC_FIX = /[0-9]+[ \t]*LOC|[0-9]+[ \t]*lines?/i;                      // F5 fix: unit-anchored — drops the bare "~N"; [ \t] not \s (cross-newline on joined body)
const LOC_FIELD = /loc-estimate[ \t]*:/i;                                   // meta-block-field awareness; [ \t] not \s (fold parity with the shipped hook)
const DONE = /\[x\]|✅|~~|^\s*[-*]?\s*\[?[ xX]?\]?\s*(SHIPPED|DONE|RESOLVED|COMPLETE|STRIKE)\b/i;
const BLOCKER = /needs (prod|production) data|needs a (design|content|schema|product|re-home) decision|blocked on|blocked by|requires .{0,30}? first|entangled with|can'?t until|cannot until|depends on .{0,30}? landing|waiting on/i;
const VERIFIED = /(?<![-\w])verified\s*:|verified\s*(→|->|=)|(verified|checked|confirmed|ran)\b[^`\n]{0,30}`(rg|grep|git|node|npm|psql)\b/i;
const HEADER = /^\s{0,3}[-*]\s*\[[ xX~]\]/;

// Current per-LINE grammar (exactly what the hook does today).
function firesCurrent(line) {
  if (DONE.test(line) || !DEFER.test(line)) return false;
  const unverifiedBlocker = BLOCKER.test(line) && !VERIFIED.test(line);
  return !(LOC_CUR.test(line) && !unverifiedBlocker);
}

// Group a line array into items (header + continuation lines) with precomputed residue.
function buildItems(lines) {
  const items = [];
  let cur = null;
  for (const ln of lines) {
    if (HEADER.test(ln)) { cur = { lines: [] }; items.push(cur); }
    if (cur) cur.lines.push(ln);
    else { if (!items._orphan) { items._orphan = { lines: [] }; } items._orphan.lines.push(ln); }
  }
  const finalize = (it) => {
    const body = it.lines.join("\n");
    it.loc = LOC_FIX.test(body) || LOC_FIELD.test(body); // proposed residue: real LOC OR an loc-estimate: field
    it.verified = VERIFIED.test(body);
    return it;
  };
  items.forEach(finalize);
  if (items._orphan) finalize(items._orphan);
  return items;
}
function itemForLine(items, line) {
  for (const it of items) if (it.lines.includes(line)) return it;
  return items._orphan && items._orphan.lines.includes(line) ? items._orphan : null;
}
// Proposed item-grammar (disk-context: residue may be on any line of the item).
function firesProposed(line, item) {
  if (DONE.test(line) || !DEFER.test(line)) return false;
  if (!item) return true; // no header context (true orphan) → cannot vouch → fire (conservative)
  const unverifiedBlocker = BLOCKER.test(line) && !item.verified;
  return !(item.loc && !unverifiedBlocker);
}
// Does a current-suppression rely ONLY on the F5 bare-"~N" time-estimate?
function f5Suppressed(line) {
  return firesCurrent === undefined ? false : (LOC_CUR.test(line) && !LOC_FIX.test(line) && !/[0-9]+\s*LOC|[0-9]+\s*lines?/i.test(line));
}

// ── (3) self-test with RED controls ──────────────────────────────────────────
function selfTest() {
  const fixtures = [
    { name: "FP: continuation line under an item carrying a loc-estimate: field (a tracker-row shape)",
      lines: ["- [ ] thing", "    trigger: post-launch when data exists", "    loc-estimate: 1 DB query + decision"],
      fireLine: "    trigger: post-launch when data exists",
      wantCurrent: true, wantProposed: false },
    { name: "TP: bare vague defer, no estimate anywhere",
      lines: ["- [ ] vague thing, revisit post-launch, monitor and see"],
      fireLine: "- [ ] vague thing, revisit post-launch, monitor and see",
      wantCurrent: true, wantProposed: true },
    { name: "F5: time-estimate '~1-2h' wrongly accepted as LOC by current, flagged by proposed",
      lines: ["- [ ] defer this post-launch, ~1-2h of work"],
      fireLine: "- [ ] defer this post-launch, ~1-2h of work",
      wantCurrent: false, wantProposed: true },
    { name: "SAFE: real LOC on header, defer word too — neither fires",
      lines: ["- [ ] tidy this, revisit later — ~15 LOC"],
      fireLine: "- [ ] tidy this, revisit later — ~15 LOC",
      wantCurrent: false, wantProposed: false },
  ];
  let pass = 0, fail = 0;
  for (const f of fixtures) {
    const items = buildItems(f.lines);
    const gotCur = firesCurrent(f.fireLine);
    const gotProp = firesProposed(f.fireLine, itemForLine(items, f.fireLine));
    const ok = gotCur === f.wantCurrent && gotProp === f.wantProposed;
    console.log(`  ${ok ? "PASS" : "FAIL"}  current=${gotCur}(want ${f.wantCurrent}) proposed=${gotProp}(want ${f.wantProposed})  ${f.name}`);
    ok ? pass++ : fail++;
  }
  console.log(`\nself-test: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

// ── (1) replay + (2) label ────────────────────────────────────────────────────
function main(since) {
  // commits touching todo.txt since the hook shipped, oldest→newest
  const commits = sh(`git log --since=${since} "--format=%H|%cI" --reverse -- todo.txt`).trim().split("\n").filter(Boolean)
    .map((l) => { const [sha, date] = l.split("|"); return { sha, date }; });
  console.log(`INPUTS: ${commits.length} commits to todo.txt since ${since} · grammar ported from .claude/hooks/defer-loc-check.sh · READ-ONLY (no writes)`);

  const fileCache = new Map();
  const fileItems = (sha) => {
    if (!fileCache.has(sha)) fileCache.set(sha, buildItems(sh(`git show ${sha}:todo.txt`).split("\n")));
    return fileCache.get(sha);
  };

  let curFires = 0, propFires = 0, eliminated = 0, f5only = 0, ambiguousItem = 0;
  const curFireCommits = new Set();
  const samplesElim = [], samplesResid = [];
  for (const { sha } of commits) {
    // added lines in this commit (unified=0; skip the +++ header)
    const diff = sh(`git show ${sha} --format= --unified=0 -- todo.txt`);
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    let items = null;
    for (const line of added) {
      if (!firesCurrent(line)) continue;
      curFires++; curFireCommits.add(sha);
      if (items === null) items = fileItems(sha);
      const it = itemForLine(items, line);
      if (it === null || it._synthetic) ambiguousItem++;
      const propFire = firesProposed(line, it);
      if (propFire) { propFires++; if (samplesResid.length < 6) samplesResid.push([sha.slice(0, 8), line.trim().slice(0, 90)]); }
      else { eliminated++; if (samplesElim.length < 6) samplesElim.push([sha.slice(0, 8), line.trim().slice(0, 90)]); }
      if (LOC_CUR.test(line) && !LOC_FIX.test(line)) f5only++; // current passed only via a bare "~N"
    }
  }

  console.log(`\n── (1) WRITE-STREAM REPLAY (the surface the hook actually scans) ──`);
  console.log(`  current grammar fires:        ${curFires}  (across ${curFireCommits.size} commits)`);
  console.log(`  proposed item-grammar fires:  ${propFires}`);
  console.log(`  → ELIMINATED by the fix:      ${eliminated}  (${curFires ? Math.round((eliminated / curFires) * 100) : 0}% of current fires — the item-grammar FP class)`);
  console.log(`  → residual (fix does NOT remove): ${propFires}  ${ambiguousItem ? `(${ambiguousItem} duplicate-line item lookups — see caveat)` : ""}`);
  console.log(`  F5 note: ${f5only} added lines were suppressed by current ONLY via a bare "~N" (time-estimate FN vector)`);
  console.log(`\n  sample ELIMINATED (item carries an estimate on a sibling line → the fix's value):`);
  samplesElim.forEach(([s, l]) => console.log(`    ${s}  ${l}`));
  console.log(`  sample RESIDUAL (still fires under the fix — genuine no-estimate OR non-defer prose):`);
  samplesResid.forEach(([s, l]) => console.log(`    ${s}  ${l}`));

  // ── (2) label the archived real fires ──
  const arch = `${ROOT}/.claude/logs/defer-loc-check-fires.archive-2026-07-12.jsonl`;
  console.log(`\n── (2) ARCHIVED REAL FIRES — correlate to commit + label ──`);
  if (!existsSync(arch)) { console.log(`  (archive not found: ${arch})`); return; }
  const realFires = readFileSync(arch, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((d) => d && !String(d.file).startsWith("/x/"));
  // commit index: (date → sha), ascending
  const idx = sh(`git log "--format=%cI|%H" --reverse -- todo.txt`).trim().split("\n").filter(Boolean)
    .map((l) => { const [date, sha] = l.split("|"); return { t: Date.parse(date), sha }; });
  let tp = 0, fp = 0, unmatched = 0;
  for (const fire of realFires) {
    const ft = Date.parse(fire.ts);
    const hit = idx.find((c) => c.t >= ft && c.t - ft < 15 * 60 * 1000); // nearest commit within 15 min after
    if (!hit) { console.log(`  ${fire.ts}  → (no commit within 15min — pre-schema, unlabelable)`); unmatched++; continue; }
    const items = fileItems(hit.sha);
    const diff = sh(`git show ${hit.sha} --format= --unified=0 -- todo.txt`);
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    const firedNow = added.filter(firesCurrent);
    const label = firedNow.some((l) => !firesProposed(l, itemForLine(items, l))) ? "FP(item-grammar)" : (firedNow.length ? "TP" : "no-current-fire");
    if (label.startsWith("FP")) fp++; else if (label === "TP") tp++;
    const eg = firedNow[0] ? firedNow[0].trim().slice(0, 70) : "(current grammar no longer fires this commit)";
    console.log(`  ${fire.ts} → +${Math.round((hit.t - ft) / 1000)}s ${hit.sha.slice(0, 8)}  [${label}]  ${eg}`);
  }
  console.log(`\n  labeled: ${fp} FP(item-grammar-class) · ${tp} TP · ${unmatched} unmatchable`);
  console.log(`\nVERDICT INPUT: the item-grammar fix removes ${eliminated}/${curFires} replayed fires; ${fp}/${realFires.length} archived fires are the FP class it targets. Ship B (item-grammar + meta-block-field + F5) iff this FP class dominates AND the residual is acceptable warn-noise. Block-mode stays retired (panel type-ruling).`);
  console.log(`CAVEAT: commit-level added-lines approximate Edit-level changed regions (a squashed commit merges Edits; never-committed transient edits are unseen). Duplicate-line item lookups take the first match. Order-of-magnitude + composition are robust; exact counts are not per-Edit.`);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else main((args.find((a) => a.startsWith("--since=")) || "--since=2026-06-21").split("=")[1]);
