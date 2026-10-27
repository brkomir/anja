#!/usr/bin/env node
/**
 * plan-roll — move a working plan's OLDEST dated blocks, word for word, into `-partN.md` files once
 * the plan passes ROLL_AT bytes, so the live plan stays under the Read tool's 262,144-byte cap.
 *
 * Source: a 2026-10-15 review of the session lifecycle found 15 of 130 plans past the cap.
 * The plan rule says rows are edited
 * in place and never deleted, so this tool deletes nothing: every byte it takes out of the live plan
 * is in a part file, and it proves that before it writes (`unroll` rebuilds the original exactly).
 *
 * Runs from `scripts/summary-plan-sync.mjs`, which /summary, /working-plan, /post-compact and
 * /pre-compact already run, so a plan rolls at its next sync. By hand:
 *     node scripts/plan-roll.mjs <plan> [--check] [--date YYYY-MM-DD]
 *     node scripts/plan-roll.mjs --self-test
 *
 * WHAT STAYS IN THE LIVE PLAN, WHOLE: everything above the first `## ` heading; every `## ` block
 * whose heading carries no date (the arc, the live item table, the review ledger, closability);
 * every block whose heading says "Host position" or "live"; the SUMMARY-SYNC fence and anything
 * after it up to the next heading; and the block holding each of the two newest `PRE-COMPACT` banks
 * (the recovery's `find_bank` reads banks with BANK_HEAD_RE, copied from
 * `scripts/post-compact-recovery-index.py`; the self-test checks the copy).
 *
 * WHAT MOVES: dated `## ` blocks, oldest heading date first, until the live plan is at or below
 * TARGET bytes. A moved block leaves a STUB in its place: its own heading line, one pointer line,
 * and every other line of the block that starts with `#` and a space, in order, inside a text fence.
 * Those lines stay because /summary, /post-compact and /pre-compact all check a plan by diffing its
 * `^#\+ ` lines against HEAD and read a missing one as destroyed text; with every such line kept,
 * that diff reads the same before and after a roll.
 *
 * Part files are `<plan without .md>-part<N>.md`, N counting up from 2, each at most PART_CAP bytes
 * (one oversized block goes alone). `-partN.md` sorts BEFORE `.md` in byte order, so every reader
 * that takes the last `session-<sid8>-*.md` (session-start.sh, /summary, /working-plan) still lands
 * on the live plan; `findPlan` in the sync skips part files outright. A part file is new and
 * untracked: commit it with the plan.
 *
 * REFUSES, writing nothing, when it cannot parse the plan safely: an unclosed code fence, a fence
 * BEGIN without its END, a part file name already taken, or a rebuilt original that does not match.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMain as isMainModule } from "./lib/is-main.mjs";

export const ROLL_AT = 200_000;
export const TARGET = 150_000;
export const PART_CAP = 200_000;
export const POINTER_PREFIX = "> plan-roll: ";
// Copied from scripts/post-compact-recovery-index.py (the self-test reads that file and compares).
export const BANK_HEAD_RE = /^#{2,3} PRE-COMPACT\b/;
const BANK_TS_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)Z/;
const FENCE_BEGIN = "<!-- SUMMARY-SYNC:BEGIN";
const FENCE_END = "<!-- SUMMARY-SYNC:END";
const HEADING_LINE = /^#+ /; // the `grep '^#\+ '` the heading diff runs
const BLOCK_MARK = /^<!-- plan-roll block (\d+) -->$/;
const bytes = (s) => Buffer.byteLength(s, "utf8");

/** Split into segments: preamble, `## ` sections, the sync fence, and loose text after it. */
export function parseSegments(text) {
  const lines = text.split("\n");
  const starts = []; // [lineIndex, kind]
  let fence = null; // open code fence: { ch, len }
  let inSync = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = { ch: f[1][0], len: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;
    if (l.startsWith(FENCE_BEGIN)) {
      if (inSync) return { error: "a second SUMMARY-SYNC BEGIN before the END" };
      inSync = true;
      starts.push([i, "fence"]);
    } else if (l.startsWith(FENCE_END)) {
      if (!inSync) return { error: "a SUMMARY-SYNC END with no BEGIN above it" };
      inSync = false;
      if (i + 1 < lines.length) starts.push([i + 1, "loose"]);
    } else if (!inSync && l.startsWith("## ")) {
      starts.push([i, "section"]);
    }
  }
  if (fence) return { error: "a code fence is never closed" };
  if (inSync) return { error: "the SUMMARY-SYNC fence has no END" };
  if (!starts.length || starts[0][0] !== 0) starts.unshift([0, "preamble"]);
  const segs = [];
  for (let k = 0; k < starts.length; k++) {
    const [a, kind] = starts[k];
    const b = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
    if (a === b) continue;
    let t = lines.slice(a, b).join("\n");
    if (b < lines.length) t += "\n";
    segs.push({ kind, text: t, heading: kind === "section" ? lines[a] : null });
  }
  if (segs.map((s) => s.text).join("") !== text) return { error: "internal: segments do not add up to the file" };
  return { segs };
}

/** The sort key of a dated heading: its first date, plus the time right after it when there is one. */
export function headingKey(heading) {
  const m = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}|\dx|xx))?/.exec(heading || "");
  if (!m) return null;
  return `${m[1]}T${m[2] || "00"}:${(m[3] || "00").replace(/x/g, "0")}`;
}

function makeStub(seg, partRel, k, date) {
  const kept = seg.text.split("\n").slice(1).filter((l) => HEADING_LINE.test(l));
  let s = `${seg.heading}\n${POINTER_PREFIX}the rest of this block moved word for word to \`${partRel}\` (block ${k}) on ${date}. The heading lines below stay here so the heading check against HEAD still matches.\n`;
  if (kept.length) s += "```text\n" + kept.join("\n") + "\n```\n";
  return s + "\n";
}

function partHeader(n, liveRel, date) {
  return `# Part ${n} of the working plan \`${liveRel}\`: older blocks moved here word for word by plan-roll on ${date}. The live plan keeps each block's headings and a pointer to its block number here.\n\n`;
}

/**
 * Pure. `liveRel` is the plan's repo-relative path, `takenParts` the part numbers already on disk.
 * Returns { status: "under" | "nothing" | "rolled" | "refused", live, parts: [{ rel, text }], moved,
 * movedBytes, reason }.
 */
export function planRoll(text, { liveRel, takenParts = [], date, rollAt = ROLL_AT, target = TARGET, partCap = PART_CAP }) {
  const total = bytes(text);
  if (total <= rollAt) return { status: "under", live: text, parts: [], moved: 0, movedBytes: 0 };
  const p = parseSegments(text);
  if (p.error) return { status: "refused", reason: p.error };
  const { segs } = p;
  // the two newest banks, read the way find_bank reads them: every line, fence-blind
  const banks = [];
  segs.forEach((s, i) => s.text.split("\n").forEach((l) => {
    if (!BANK_HEAD_RE.test(l)) return;
    const m = BANK_TS_RE.exec(l);
    if (m) banks.push({ ts: m[1].length === 19 ? m[1] : m[1] + ":00", seg: i });
  }));
  banks.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const keepBank = new Set(banks.slice(0, 2).map((b) => b.seg));
  const stem = liveRel.replace(/\.md$/, "");
  let n0 = Math.max(1, ...takenParts) + 1;
  const probeRel = `${stem}-part${n0 + 99}.md`;
  // the newest CLOSABILITY and Owner-pending blocks are the plan's current verdicts (plan rule), so they stay
  const STATE_RE = /^## (closability|owner[- ]pending)\b/i;
  const newestState = new Map();
  segs.forEach((s, i) => { const m = s.kind === "section" && STATE_RE.exec(s.heading); const k = m && headingKey(s.heading);
    if (k && !(newestState.get(m[1].toLowerCase())?.k > k)) newestState.set(m[1].toLowerCase(), { k, i }); });
  const keepState = new Set([...newestState.values()].map((v) => v.i));
  const candidates = [];
  segs.forEach((s, i) => {
    if (s.kind !== "section") return;
    const second = s.text.split("\n")[1] || "";
    if (second.startsWith(POINTER_PREFIX)) return; // already a stub
    if (/host position/i.test(s.heading) || /\blive\b/i.test(s.heading) || keepBank.has(i) || keepState.has(i)) return;
    const key = headingKey(s.heading);
    if (!key) return;
    const gain = bytes(s.text) - bytes(makeStub(s, probeRel, 9999, date));
    if (gain > 0) candidates.push({ i, key, gain });
  });
  candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i));
  let projected = total;
  const chosen = new Set();
  for (const c of candidates) {
    if (projected <= target) break;
    chosen.add(c.i);
    projected -= c.gain;
  }
  if (!chosen.size) return { status: "nothing", live: text, parts: [], moved: 0, movedBytes: 0,
    reason: "no dated block is left to move; what remains is the top sections, banks, host positions and stubs" };
  // pack the chosen blocks, in file order, into parts of at most partCap bytes
  const order = [...chosen].sort((a, b) => a - b);
  const parts = [];
  let cur = null;
  for (const i of order) {
    const s = segs[i];
    const add = bytes(`<!-- plan-roll block 99 -->\n`) + bytes(s.text);
    if (!cur || (cur.size + add > partCap && cur.blocks.length)) {
      const n = n0++;
      cur = { n, rel: `${stem}-part${n}.md`, blocks: [], size: bytes(partHeader(n, liveRel, date)) };
      parts.push(cur);
    }
    cur.blocks.push(i);
    cur.size += add;
  }
  const stubOf = new Map();
  const partTexts = parts.map((pt) => {
    let t = partHeader(pt.n, liveRel, date);
    pt.blocks.forEach((i, j) => {
      t += `<!-- plan-roll block ${j + 1} -->\n` + segs[i].text;
      stubOf.set(i, makeStub(segs[i], pt.rel, j + 1, date));
    });
    return { rel: pt.rel, text: t };
  });
  const live = segs.map((s, i) => stubOf.get(i) ?? s.text).join("");
  const back = unroll(live, partTexts, date);
  if (back !== text) return { status: "refused", reason: "the rebuilt original does not match the plan, so nothing was written" };
  const movedBytes = order.reduce((a, i) => a + bytes(segs[i].text), 0);
  return { status: "rolled", live, parts: partTexts, moved: order.length, movedBytes };
}

/** Rebuild the plan as it was before a roll: every stub naming one of `parts` gets its block back. */
export function unroll(live, parts, date) {
  let out = live;
  for (const { rel, text } of parts) {
    // block k is everything between the end of marker line k and the start of marker line k+1
    const marks = [];
    let at = 0;
    for (const line of text.split("\n")) {
      if (BLOCK_MARK.test(line)) marks.push({ start: at, end: at + line.length + 1 });
      at += line.length + 1;
    }
    marks.forEach((mk, j) => {
      const segText = text.slice(mk.end, j + 1 < marks.length ? marks[j + 1].start : text.length);
      const stub = makeStub({ heading: segText.split("\n")[0], text: segText }, rel, j + 1, date);
      if (out.split(stub).length !== 2) return; // not there exactly once: leave it; the caller compares
      out = out.replace(stub, () => segText);
    });
  }
  return out;
}

export function partNumbersOnDisk(livePath) {
  const dir = path.dirname(livePath);
  const base = path.basename(livePath).replace(/\.md$/, "");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-part(\\d+)\\.md$`).exec(f))
    .filter(Boolean).map((m) => +m[1]);
}

/** Roll `text` (the plan's content to be written) for the plan at `livePath`; writes the PARTS only when
 *  `write` (the caller writes the live plan, after them). Part names in pointers read `plans/<file>`
 *  when the plan sits in a `plans/` directory, as every session plan does. */
export function rollText(text, livePath, { write = false, date = new Date().toISOString().slice(0, 10) } = {}) {
  const dir = path.dirname(livePath);
  const liveRel = (path.basename(path.resolve(dir)) === "plans" ? "plans/" : "") + path.basename(livePath);
  const r = planRoll(text, { liveRel, takenParts: partNumbersOnDisk(livePath), date });
  if (r.status === "rolled" && write) {
    const at = (rel) => path.join(dir, path.basename(rel));
    const taken = r.parts.find((pt) => fs.existsSync(at(pt.rel)));
    if (taken) return { status: "refused", reason: `${taken.rel} already exists` };
    const raced = writePartsExclusive(dir, r.parts);
    if (raced) return { status: "refused", reason: raced };
  }
  return r;
}

/** Write each part with an exclusive create. A part that appeared since the existsSync check (another sync
 *  racing this one) refuses the roll: the parts this call already wrote are removed, so no orphan is left and
 *  the file the other writer made is never touched. Returns null when all were written, else the reason. */
export function writePartsExclusive(dir, parts) {
  const written = [];
  for (const pt of parts) {
    const p = path.join(dir, path.basename(pt.rel));
    try {
      fs.writeFileSync(p, pt.text, { flag: "wx" });
      written.push(p);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      for (const w of written) fs.unlinkSync(w);
      return `${pt.rel} appeared while this roll was writing (another sync of this plan?); nothing was kept`;
    }
  }
  return null;
}

/** One plain clause for a verdict line. */
export function rollWords(r, { check = false } = {}) {
  if (r.status === "rolled") {
    const names = r.parts.map((p) => p.rel).join(", ");
    return check
      ? ` — would move ${r.moved} old blocks (${r.movedBytes.toLocaleString("en-US")} bytes) to ${names}`
      : ` — moved ${r.moved} old blocks (${r.movedBytes.toLocaleString("en-US")} bytes) word for word to ${names}; commit ${r.parts.length > 1 ? "them" : "it"} with the plan`;
  }
  if (r.status === "refused") return ` — plan over ${ROLL_AT.toLocaleString("en-US")} bytes, not rolled: ${r.reason}`;
  if (r.status === "nothing") return ` — plan over ${ROLL_AT.toLocaleString("en-US")} bytes, not rolled: ${r.reason}`;
  return "";
}

// ------------------------------------------------------------------ self-test
/** The bytes of every stub a roll wrote, rebuilt from its parts. */
function stubTotal(r, date) {
  let t = 0;
  for (const { rel, text } of r.parts) {
    const ls = text.split("\n");
    let at = 0;
    const marks = [];
    for (const l of ls) { if (BLOCK_MARK.test(l)) marks.push({ start: at, end: at + l.length + 1 }); at += l.length + 1; }
    marks.forEach((mk, j) => {
      const seg = text.slice(mk.end, j + 1 < marks.length ? marks[j + 1].start : text.length);
      t += bytes(makeStub({ heading: seg.split("\n")[0], text: seg }, rel, j + 1, date));
    });
  }
  return t;
}

function selfTest() {
  let fail = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got).slice(0, 300)}, want ${JSON.stringify(want).slice(0, 300)}`); }
  };
  const heads = (t) => t.split("\n").filter((l) => HEADING_LINE.test(l));
  const filler = (n) => ("x".repeat(99) + "\n").repeat(n);
  const blk = (h, n, extra = "") => `## ${h}\n${extra}${filler(n)}\n`;
  const D = "2026-10-25";
  const plan = "# Session t — working plan\n\n## Arc\nwhat\n\n## Live items\n| a | b |\n\n## Review ledger\nrows\n\n## Closability\nNO\n\n"
    + blk("POST-COMPACT — 2026-10-01T01:00:00Z", 400, "### sub one\n```bash\n# a comment\n## not a heading\n```\n")
    + blk("PRE-COMPACT — 2026-10-01T02:00:00Z (AUTO)", 400)
    + blk("Host position (committed 2026-10-01T03:00Z)", 50)
    + blk("IN FLIGHT — 2026-10-02T04:00Z", 400)
    + "<!-- SUMMARY-SYNC:BEGIN — derived -->\nfence body\n<!-- SUMMARY-SYNC:END -->\n\n"
    + blk("PRE-COMPACT — 2026-10-03T05:00:00Z (--disarm)", 300)
    + blk("POST-COMPACT — 2026-10-03T05:10Z", 300)
    + blk("PRE-COMPACT — 2026-10-04T06:00:00Z", 300)
    + blk("Later notes, undated", 30)
    + blk("WRAP — LIVE STATE (updated 2026-10-01)", 30);
  const r = planRoll(plan, { liveRel: "plans/session-t-2026-10-01.md", date: D, rollAt: 150_000, target: 120_000, partCap: 50_000 });
  eq("rolls an over-size plan", r.status, "rolled");
  eq("conservation: the rebuilt original is byte-identical", unroll(r.live, r.parts, D) === plan, true);
  // byte budget: what left the live plan (block minus stub) is exactly what the parts carry past
  // their header and markers
  const stubBytes = r.live.split("\n").filter((l) => l.startsWith(POINTER_PREFIX)).length;
  const carried = r.parts.reduce((a, p) => a + bytes(p.text) - bytes(p.text.split("\n")[0] + "\n\n")
    - p.text.split("\n").filter((l) => BLOCK_MARK.test(l)).reduce((x, l) => x + bytes(l) + 1, 0), 0);
  eq("byte budget: the parts carry exactly the moved bytes", carried, r.movedBytes);
  eq("byte budget: live - stubs + moved = original", bytes(r.live) - stubTotal(r, D) + r.movedBytes, bytes(plan));
  eq("one pointer line per moved block", stubBytes, r.moved);
  eq("the heading lines the HEAD diff reads are unchanged", heads(r.live), heads(plan));
  eq("live is at or below the target", bytes(r.live) <= 120_000, true);
  eq("oldest first: the 10-01 POST-COMPACT moved", r.live.includes("## POST-COMPACT — 2026-10-01T01:00:00Z\n> plan-roll: "), true);
  eq("the two newest banks stay whole", [r.live.includes("## PRE-COMPACT — 2026-10-04T06:00:00Z\n" + "x".repeat(99)),
    r.live.includes("## PRE-COMPACT — 2026-10-03T05:00:00Z (--disarm)\n" + "x".repeat(99))], [true, true]);
  // a bar low enough to move every dated block: only the protections keep anything whole
  const deep = planRoll(plan, { liveRel: "plans/session-t-2026-10-01.md", date: D, rollAt: 150_000, target: 1, partCap: 50_000 });
  eq("deep roll: the two newest banks stay whole, the oldest bank moves", [
    deep.live.includes("## PRE-COMPACT — 2026-10-04T06:00:00Z\n" + "x".repeat(99)),
    deep.live.includes("## PRE-COMPACT — 2026-10-03T05:00:00Z (--disarm)\n" + "x".repeat(99)),
    deep.live.includes("## PRE-COMPACT — 2026-10-01T02:00:00Z (AUTO)\n" + POINTER_PREFIX)], [true, true, true]);
  eq("deep roll: host position, undated and live blocks stay whole", [
    deep.live.includes("## Host position (committed 2026-10-01T03:00Z)\n" + "x".repeat(99)),
    deep.live.includes("## Later notes, undated\n" + "x".repeat(99)),
    deep.live.includes("## WRAP — LIVE STATE (updated 2026-10-01)\n" + "x".repeat(99))], [true, true, true]);
  eq("deep roll: rebuilds", unroll(deep.live, deep.parts, D) === plan, true);
  // the newest dated CLOSABILITY and Owner-pending blocks are the current verdicts: they stay whole, older ones move
  const planS = plan.replace("<!-- SUMMARY-SYNC:BEGIN", blk("CLOSABILITY — 2026-10-02T01:00:00Z", 50) + blk("CLOSABILITY — 2026-10-03T07:00:00Z", 50)
    + blk("Owner-pending — 2026-10-02 08:00Z", 50) + blk("Owner-pending — 2026-10-03 09:00Z", 50) + "<!-- SUMMARY-SYNC:BEGIN");
  const deepS = planRoll(planS, { liveRel: "plans/session-t-2026-10-01.md", date: D, rollAt: 150_000, target: 1, partCap: 50_000 });
  eq("deep roll: the newest CLOSABILITY and Owner-pending stay whole, the older ones move", [
    deepS.live.includes("## CLOSABILITY — 2026-10-03T07:00:00Z\n" + "x".repeat(99)),
    deepS.live.includes("## Owner-pending — 2026-10-03 09:00Z\n" + "x".repeat(99)),
    deepS.live.includes("## CLOSABILITY — 2026-10-02T01:00:00Z\n" + POINTER_PREFIX),
    deepS.live.includes("## Owner-pending — 2026-10-02 08:00Z\n" + POINTER_PREFIX),
    unroll(deepS.live, deepS.parts, D) === planS], [true, true, true, true, true]);
  eq("host position stays whole", r.live.includes("## Host position (committed 2026-10-01T03:00Z)\n" + "x".repeat(99)), true);
  eq("top sections stay whole", r.live.startsWith("# Session t — working plan\n\n## Arc\nwhat\n\n## Live items\n| a | b |\n\n## Review ledger\nrows\n\n## Closability\nNO\n\n"), true);
  eq("the fence stays", r.live.includes("<!-- SUMMARY-SYNC:BEGIN — derived -->\nfence body\n<!-- SUMMARY-SYNC:END -->\n"), true);
  eq("parts are capped (each under 50,000 bytes, or one block alone)", r.parts.every((p) => bytes(p.text) <= 50_000 + 41_000), true);
  eq("parts are numbered from 2", r.parts[0].rel, "plans/session-t-2026-10-01-part2.md");
  eq("each part sorts before the live plan", r.parts.every((p) => Buffer.compare(Buffer.from(p.rel), Buffer.from("plans/session-t-2026-10-01.md")) < 0), true);
  // idempotent: a second run on the rolled plan is under the bar and changes nothing
  const r2 = planRoll(r.live, { liveRel: "plans/session-t-2026-10-01.md", date: D, rollAt: 150_000, target: 120_000, partCap: 50_000, takenParts: [2, 3] });
  eq("idempotent: a rolled plan is not rolled again", [r2.status, r2.live === r.live], ["under", true]);
  // a stub is never moved again, even when the bar is lowered
  const r3 = planRoll(r.live, { liveRel: "plans/session-t-2026-10-01.md", date: D, rollAt: 10, target: 10, takenParts: r.parts.map((p) => +/part(\d+)/.exec(p.rel)[1]) });
  eq("a lowered bar rolls the plan again", r3.status, "rolled");
  eq("a second roll keeps every earlier stub", r3.live.split("\n" + POINTER_PREFIX).length - 1, r.moved + r3.moved);
  eq("a second roll numbers past the parts on disk", r3.parts.some((p) => r.parts.some((q) => q.rel === p.rel)), false);
  eq("a second roll still rebuilds the first original", unroll(unroll(r3.live, r3.parts, D), r.parts, D) === plan, true);
  // refusals
  eq("refuses an unclosed code fence", planRoll(plan + "```\nopen\n", { liveRel: "p.md", date: D, rollAt: 10 }).status, "refused");
  eq("refuses a BEGIN with no END", planRoll(plan + "<!-- SUMMARY-SYNC:BEGIN x -->\n", { liveRel: "p.md", date: D, rollAt: 10 }).status, "refused");
  eq("under the bar does nothing", planRoll("# x\n", { liveRel: "p.md", date: D }).status, "under");
  eq("nothing movable is said, not forced", planRoll("# x\n## Arc\n" + filler(3000), { liveRel: "p.md", date: D }).status, "nothing");
  // a plan with no trailing newline still rebuilds
  const noNl = plan.replace(/\n+$/, "");
  const r4 = planRoll(noNl, { liveRel: "plans/q.md", date: D, rollAt: 150_000, target: 120_000 });
  eq("no trailing newline: rolls and rebuilds", [r4.status, r4.status === "rolled" && unroll(r4.live, r4.parts, D) === noNl], ["rolled", true]);
  // the bank regex is the recovery's own
  const py = fs.readFileSync(new URL("./post-compact-recovery-index.py", import.meta.url), "utf8");
  const m = /^BANK_HEAD_RE = re\.compile\(r"(.*)"\)$/m.exec(py);
  eq("BANK_HEAD_RE matches post-compact-recovery-index.py", m && m[1], BANK_HEAD_RE.source);
  eq("headingKey reads x-minutes as 0", headingKey("## IN FLIGHT — 2026-10-23T16:5xZ"), "2026-10-23T16:50");
  // a part that appears mid-write (a racing sync) refuses the roll and removes what this call wrote
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-roll-race-"));
  try {
    fs.writeFileSync(path.join(tmp, "q-part3.md"), "the other writer's part\n");
    const why = writePartsExclusive(tmp, [{ rel: "plans/q-part2.md", text: "mine 2\n" }, { rel: "plans/q-part3.md", text: "mine 3\n" }]);
    eq("a racing part refuses, keeps nothing of its own, and leaves the other writer's file alone", [
      typeof why === "string" && why.includes("q-part3.md"), fs.existsSync(path.join(tmp, "q-part2.md")),
      fs.readFileSync(path.join(tmp, "q-part3.md"), "utf8")], [true, false, "the other writer's part\n"]);
    eq("no race: every part is written", [writePartsExclusive(tmp, [{ rel: "plans/q-part4.md", text: "4\n" }]),
      fs.readFileSync(path.join(tmp, "q-part4.md"), "utf8")], [null, "4\n"]);
    // rollText's own wiring: a part that lands after its existsSync check refuses the roll, so the caller never
    // writes stubs that point at a part this call removed (the stub stands in for the other writer's timing)
    const other = path.join(tmp, "session-t-2026-10-01-part2.md");
    fs.writeFileSync(other, "the other writer's part\n");
    const realExists = fs.existsSync;
    let rt;
    try { fs.existsSync = () => false; rt = rollText(plan, path.join(tmp, "session-t-2026-10-01.md"), { write: true, date: D }); }
    finally { fs.existsSync = realExists; }
    eq("rollText: a part that appears after its check refuses the roll and leaves the other writer's file alone",
      [rt.status, fs.readFileSync(other, "utf8")], ["refused", "the other writer's part\n"]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(fail === 0 ? "self-test: PASS" : `self-test: ${fail} FAILED`);
  return fail === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  const known = new Set(["--check", "--date"]);
  const plan = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--date");
  const bad = argv.find((a) => a.startsWith("--") && !known.has(a)) || (argv.includes("--date") && !/^\d{4}-\d{2}-\d{2}$/.test(argv[argv.indexOf("--date") + 1] || ""));
  if (!plan || bad) {
    console.error("Usage: node scripts/plan-roll.mjs <plan> [--check] [--date YYYY-MM-DD] | --self-test");
    process.exit(2);
  }
  if (/-part\d+\.md$/.test(plan)) { console.error("plan-roll: that is a part file, not a live plan"); process.exit(2); }
  const check = argv.includes("--check");
  const date = argv.includes("--date") ? argv[argv.indexOf("--date") + 1] : undefined;
  const text = fs.readFileSync(plan, "utf8");
  const r = rollText(text, plan, { write: !check, date });
  if (r.status === "rolled" && !check) fs.writeFileSync(plan, r.live);
  const verdict = r.status === "rolled" ? (check ? "WOULD-ROLL" : "ROLLED") : r.status === "refused" ? "REFUSED" : "NOT-ROLLED";
  console.log(`PLAN-ROLL: ${verdict} ${plan}${rollWords(r, { check }) || ` — ${bytes(text).toLocaleString("en-US")} bytes, at or below ${ROLL_AT.toLocaleString("en-US")}`}`);
  process.exit(r.status === "refused" ? 1 : check && r.status === "rolled" ? 3 : 0);
}

if (isMainModule(import.meta.url)) main();
