#!/usr/bin/env node
// /deep-pass estimate (first written as /wrap --estimate, then moved here): size the 1b-DEEP pass BEFORE a wrap and advise — fire or inline (the digest when it
// fires; `/wrap --light` and `/wrap --full` priced beside it), Opus or Sonnet — from this session's own transcript, the covered-range record, the statusline limit reading and
// the measured per-slice costs recorded in the measurement registry the wrap keeps (not in this copy; the figures are
// copied into the constants below, so nothing reads it at run time). READ-ONLY: writes nothing.
//
//   node scripts/deep-pass-estimate.mjs [--sid <full session id>] [--json] [--covered <covered-range file>]
//   node scripts/deep-pass-estimate.mjs --self-test
//
// What it derives (never restates): the stripped transcript size (scripts/lib/transcript-strip.mjs, the same function
// the deep pass slices by); the scan window (the covered-range record `.claude/state/deep-pass-covered-<sid8>` when a
// completed pass wrote one, else the whole transcript — the pass's own checkpoint walk may scope a first wrap smaller,
// so "whole" is a CEILING); compaction records (`isCompactSummary`); commits since the transcript's first record
// (fleet-wide — a peer over-count only raises the fire rate, as the wrap's own trigger says); the slice counts at the
// 2 MB target (--full), the light mode's 10 MB (--light) and the digest default's 9 MB; waves under the clamp of 12; the five-hour and weekly shares and the dispatch
// guard's threshold, read off that guard's source.
//
// Advice rules (stated here so a reader can disagree with them):
//   fire   — the wrap's trigger verbatim: a compaction record AND (stripped bytes > 3,000,000 OR commits > 20).
//   depth  — digest whenever the deep pass fires: the default, with --light and --full kept as two opt-in
//            parameters. Each ~9 MB slice is read as a digest (scripts/deep-pass-digest.py). `/wrap --light` (raw 10 MB)
//            and `/wrap --full` (raw 2 MB) are opt-ins whose slice counts and waves are still printed so the operator
//            can price them.
//   model  — Opus is the default and Sonnet the alternative, and the choice between them is a preference (settled on
//            a fair test at high effort: 4 slices of one session, Opus clearly ahead on 1 and somewhat on 1, level on
//            2, Sonnet finding things Opus missed on every slice, Sonnet slightly cheaper in tokens; scored unblinded by
//            an Opus-family reader). So this prints both models' measured per-slice token ranges and the limit shares,
//            names Opus as the default, and says "none until the reset" when the share is at the guard's line.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripTranscriptLine } from "./lib/transcript-strip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SLICE_BYTES = 2_000_000, LIGHT_BYTES = 10_000_000, DIGEST_BYTES = 9_000_000, CLAMP = 12;
// The digest + ask arm of the 12-helper digest test, per helper, weighted tokens per MB of raw window: min 371k/8.22 MB, max 1,022k/9.03 MB (12 helpers; 67.5k pooled).
const DIGEST_PER_MB = [45_000, 113_000];
const FIRE_BYTES = 3_000_000, FIRE_COMMITS = 20;
// Per-slice agent tokens as MEASURED in the registry (ranges, never a point): an Opus run (6 slices, 2026-10-28) and the
// Sonnet runs of 2026-10-27 (26 slices, median ~100k) and 2026-10-28 (3 slices of 36-50k); an earlier run had 33-43k slices, so the low end is selective, not the measured range. Flat in slice size per full-text-preamble.md § Four spans (moved from the Light mode line 2026-10-29).
const TOKENS = { opus: [63_413, 96_655], sonnet: [36_164, 145_063] };

// The deep pass cuts slices by a GREEDY fill of whole stripped lines under the cap (registry: "greedy fill to the
// 2,000,000 B cap"), never mid-record, so it can need more slices than ceil(bytes / cap): count them the same way.
export function sliceCount(sizes, cap) {
  let n = 0, cur = 0;
  for (const s of sizes) { if (cur > 0 && cur + s > cap) { n++; cur = 0; } cur += s; }
  return cur > 0 ? n + 1 : n;
}
export function waves(n, clamp = CLAMP) { return n <= 0 ? 0 : Math.ceil(n / clamp); }
export function advise({ compactions, bytes, commits, scanSizes, fiveHourPct, threshold }) {
  const fire = compactions > 0 && (bytes > FIRE_BYTES || commits > FIRE_COMMITS);
  const nFull = sliceCount(scanSizes, SLICE_BYTES), nLight = sliceCount(scanSizes, LIGHT_BYTES), nDigest = sliceCount(scanSizes, DIGEST_BYTES);
  const depth = !fire ? "inline" : "digest"; // the digest is the default; --light and --full are opt-ins
  const headroom = fiveHourPct == null || threshold == null ? null : threshold - fiveHourPct;
  const limitTight = headroom != null && headroom <= 0;
  const model = !fire ? "n/a" : limitTight ? "none until the reset" : "opus";
  return { fire, nFull, nLight, nDigest, wavesFull: waves(nFull), wavesLight: waves(nLight), wavesDigest: waves(nDigest), depth, model, headroom };
}
function readThreshold() {
  const src = readFileSync(join(REPO, ".claude/hooks/agent-dispatch-session-limit-guard.py"), "utf8");
  const m = /^THRESHOLD_PCT\s*=\s*(\d+)/m.exec(src);
  return m ? Number(m[1]) : null;
}
function fmt(n) { return n.toLocaleString("en-US"); }
function run(sid, asJson, coveredPath) {
  const sid8 = sid.slice(0, 8);
  const tx = join(process.env.HOME, ".claude/projects/<project-key>", `${sid}.jsonl`);
  if (!existsSync(tx)) { console.error(`no transcript at ${tx}`); process.exit(2); }
  const lines = readFileSync(tx, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const stripped = lines.map(stripTranscriptLine);
  const sizes = stripped.map((l) => Buffer.byteLength(l, "utf8") + 1);
  const bytes = sizes.reduce((a, b) => a + b, 0);
  const compactions = lines.filter((l) => l.includes('"isCompactSummary":true')).length;
  const covered = coveredPath ?? join(REPO, `.claude/state/deep-pass-covered-${sid8}`);
  let cp = 1, windowNote = "no completed-pass record: sized over the WHOLE transcript (a ceiling — the pass's checkpoint walk may scope a first wrap smaller)";
  if (existsSync(covered)) {
    const f = readFileSync(covered, "utf8").trim().split(/\s+/);
    cp = Number(f[1]) + 1; windowNote = `since the last completed pass (covered to line ${f[1]}, ${f[2] ?? "?"} ${f[3] ?? ""})`.trim();
  }
  const scanSizes = sizes.slice(cp - 1), scanBytes = scanSizes.reduce((a, b) => a + b, 0);
  const first = /"timestamp":"([^"]+)"/.exec(lines.find((l) => l.includes('"timestamp"')) ?? "");
  let commits = null;
  if (first) { try { commits = execFileSync("git", ["-C", REPO, "rev-list", "--count", `--since=${first[1]}`, "HEAD"], { encoding: "utf8" }).trim(); commits = Number(commits); } catch { commits = null; } }
  let sl = null; const slPath = join(REPO, `.claude/state/statusline-${sid8}.json`);
  if (existsSync(slPath)) { try { sl = JSON.parse(readFileSync(slPath, "utf8")); } catch { sl = null; } }
  const fresh = sl && Date.now() / 1000 - sl.ts < 600;
  const fiveHourPct = fresh ? sl.five_hour_pct : null;
  const threshold = readThreshold();
  const a = advise({ compactions, bytes, commits: commits ?? 0, scanSizes, fiveHourPct, threshold });
  const tok = (m, n) => `${fmt(TOKENS[m][0] * n)}-${fmt(TOKENS[m][1] * n)}`;
  const out = { sid8, lines: lines.length, strippedBytes: bytes, compactions, commitsSinceStart: commits, window: { fromLine: cp, toLine: lines.length, bytes: scanBytes, note: windowNote }, slices: { digest: a.nDigest, full: a.nFull, light: a.nLight, wavesDigest: a.wavesDigest, wavesFull: a.wavesFull, wavesLight: a.wavesLight }, limit: fresh ? { fiveHourPct: sl.five_hour_pct, resetsAt: new Date(sl.five_hour_resets_at * 1000).toISOString(), sevenDayPct: sl.seven_day_pct, fableWeekPct: sl.fable_week_pct, threshold } : { stale: true, threshold }, advice: a, tokens: { opusFull: tok("opus", a.nFull), sonnetFull: tok("sonnet", a.nFull), opusLight: tok("opus", a.nLight), sonnetLight: tok("sonnet", a.nLight) } };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`deep-pass estimate — session ${sid8}`);
  console.log(`  transcript: ${fmt(lines.length)} lines, ${fmt(bytes)} B stripped; ${compactions} compaction record(s); ${commits == null ? "commits unreadable" : `${commits} commits on this branch since the first record (fleet-wide)`}`);
  console.log(`  deep pass trigger: ${a.fire ? "FIRES" : "does not fire"} (needs a compaction AND bytes > ${fmt(FIRE_BYTES)} or commits > ${FIRE_COMMITS})`);
  console.log(`  scan window: lines ${cp}-${lines.length}, ${fmt(scanBytes)} B — ${windowNote}`);
  console.log(`  digest pass (the default): ${a.nDigest} slice(s) of <= 9 MB in ${a.wavesDigest} wave(s); slice tokens opus ${fmt(Math.round(DIGEST_PER_MB[0] * scanBytes / 1e6))}-${fmt(Math.round(DIGEST_PER_MB[1] * scanBytes / 1e6))} WEIGHTED (read .1, write 1.25, input 1: not the unit of the two lines below), scaled by MB from a test of 12 digest + ask helpers (Opus, served effort high, 8.2-9.0 MB windows, one project); cost follows digest size (4.8-9.1% of raw there), so MB scaling spans 2.5x; no Sonnet or medium-effort digest arm ran`);
  console.log(`  full pass (--full): ${a.nFull} slice(s) of <= 2 MB in ${a.wavesFull} wave(s) under the clamp of ${CLAMP}; slice tokens opus ${tok("opus", a.nFull)} / sonnet ${tok("sonnet", a.nFull)} (registry ranges, orchestrator excluded, so not the whole-run price the light mode is judged on)`);
  console.log(`  light pass (--light): ${a.nLight} slice(s) of <= 10 MB in ${a.wavesLight} wave(s); slice tokens opus ${tok("opus", a.nLight)} / sonnet ${tok("sonnet", a.nLight)} — a helper takes in about 0.1 MB at either slice size, so a slice is sampled and a 10 MB one more thinly`);
  console.log(fresh ? `  limit: five-hour ${sl.five_hour_pct}% (resets ${new Date(sl.five_hour_resets_at * 1000).toISOString().slice(11, 16)}Z), seven-day ${sl.seven_day_pct}%, Fable week ${sl.fable_week_pct}%; dispatch guard denies above ${threshold}% — headroom ${a.headroom} points` : `  limit: statusline reading stale or missing — the wave budget will read it at dispatch; guard threshold ${threshold}%`);
  console.log(`  advice: ${a.fire ? `${a.model.startsWith("none") ? `no deep pass until the five-hour reset (then ${a.depth.toUpperCase()} on OPUS)` : `${a.depth.toUpperCase()} pass on ${a.model.toUpperCase()}`}` : "no deep pass — the inline 1b scan suffices"}${a.fire ? ` (the default; /wrap --light would take ${a.nLight} slice(s), /wrap --full ${a.nFull} in ${a.wavesFull} wave(s) — state the coverage trade)` : ""}${a.fire && a.model === "opus" ? "; or Sonnet with /wrap --sonnet — the choice between the two is a preference (a fair paired read: 4 fair-effort slices of one session, scored unblinded by an Opus-family reader: Opus found more on 2, level on 2, Sonnet found things Opus missed on every slice and used slightly fewer tokens; a 2026-09-29 reading had Opus slices at about twice Sonnet's tokens, but over a different window with Sonnet at a lower effort, so it is not a like-for-like cost reading)" : ""}${a.fire && a.model.startsWith("none") ? " — the five-hour share is at or above the guard's line; the wrap would run only the inline scan until the reset" : ""}`);
}
function selfTest() {
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); process.exit(1); } };
  const mb = (n) => Array(n).fill(100_000); // n records of 100 KB: n / 20 full slices exactly
  eq(sliceCount([], SLICE_BYTES), 0, "zero bytes"); eq(sliceCount([2_000_000], SLICE_BYTES), 1, "exact"); eq(sliceCount([2_000_000, 1], SLICE_BYTES), 2, "tripwire");
  eq(sliceCount([1_200_000, 1_200_000, 1_200_000], SLICE_BYTES), 3, "greedy needs more than ceil when records do not split");
  eq(waves(12), 1, "one wave"); eq(waves(13), 2, "two waves"); eq(waves(0), 0, "no waves");
  eq(advise({ compactions: 0, bytes: 9e6, commits: 50, scanSizes: mb(90), fiveHourPct: 10, threshold: 90 }).fire, false, "no compaction => no fire");
  eq(advise({ compactions: 1, bytes: 2e6, commits: 5, scanSizes: mb(20), fiveHourPct: 10, threshold: 90 }).fire, false, "below both bounds => no fire");
  eq(advise({ compactions: 1, bytes: 2e6, commits: 21, scanSizes: mb(20), fiveHourPct: 10, threshold: 90 }).fire, true, "commits alone fire");
  const full = advise({ compactions: 2, bytes: 20e6, commits: 5, scanSizes: mb(200), fiveHourPct: 40, threshold: 90 });
  eq([full.depth, full.model, full.nFull, full.wavesFull, full.nDigest], ["digest", "opus", 10, 1, 3], "the digest is the default even when the full pass fits one wave");
  const light = advise({ compactions: 2, bytes: 50e6, commits: 5, scanSizes: mb(500), fiveHourPct: 40, threshold: 90 });
  eq([light.depth, light.nFull, light.nLight, light.wavesFull, light.nDigest], ["digest", 25, 5, 3, 6], "the digest over the clamp too, with the full and light counts still printed");
  eq(advise({ compactions: 2, bytes: 50e6, commits: 5, scanSizes: mb(500), fiveHourPct: 91, threshold: 90 }).model, "none until the reset", "limit at the line");
  eq(advise({ compactions: 2, bytes: 50e6, commits: 5, scanSizes: mb(500), fiveHourPct: null, threshold: 90 }).model, "opus", "no reading => opus, headroom null");
  console.log("deep-pass-estimate self-test: 14 assertions OK");
}
const argv = process.argv.slice(2);
// Only as a CLI: an import (the vitest file) must neither run the estimate nor exit on a missing session id.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (!isMain) { /* imported */ } else if (argv.includes("--self-test")) selfTest();
else { const i = argv.indexOf("--sid"); const sid = i >= 0 ? argv[i + 1] : process.env.CLAUDE_CODE_SESSION_ID; if (!sid) { console.error("usage: node scripts/deep-pass-estimate.mjs [--sid <id>] [--json] | --self-test"); process.exit(2); } const c = argv.indexOf("--covered"); run(sid, argv.includes("--json"), c >= 0 ? argv[c + 1] : undefined); }
