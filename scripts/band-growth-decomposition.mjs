#!/usr/bin/env node
// band-growth-decomposition.mjs — the campaign-vs-structural discriminator for the always-loaded band.
//
// WHY THIS EXISTS. Two correct measurements of the same corpus reached opposite conclusions
// (2026-08-17): a 49h window on one file said "cuts get erased in a day", a 7d window on
// the whole plane said "the corpus is shrinking 33%". Both were arithmetically exact. Both were
// LEVEL measurements over a window, and a level over a window is dominated by whether a
// displacement campaign happened to land inside it — so the window choice decides the answer and
// nothing in the data can adjudicate the window choice. That is unfalsifiable narrative, not
// measurement.
//
// THE FIX IS THE UNIT, NOT THE WINDOW. Decompose every band commit's signed byte delta into
// GROWTH and CUT, and report them SEPARATELY:
//   · growth  = a property of the WRITE PATH  -> per-add-commit rate, expected stationary
//   · cuts    = a property of WHO WAS WORKING -> expected concentrated in few days/commits
// The per-add-commit rate is window-INSENSITIVE (report its CV), so it can carry a standing
// policy. The net level cannot.
//
// ⛔ DO NOT REACH FOR SESSION ATTRIBUTION HERE. Measured 2026-08-17: only 73 of 255 band commits
// in the window carry a `Claude-Session:` trailer (28.6%), because safe-commit.sh began
// auto-stamping it only THAT DAY — so coverage correlates with recency, which
// correlates with the campaign being classified. An attribution instrument returns a plausible
// partial answer over a biased subpopulation. The byte delta exists for 100% of commits; use it.
//
// PLANE. Mirrors baselineTotal() in check-band-budget.mjs EXACTLY (CLAUDE.md + AGENTS.md +
// .claude/rules/**.md) — the GATE plane, which is orchestrator-EXCLUSIVE. That is deliberate:
// mixing it with the orchestrator-inclusive report plane is a 18,677 B error. Always name a SHA.
//
// Usage:  node scripts/band-growth-decomposition.mjs [--since=YYYY-MM-DD] [--pin=<sha>]
//         node scripts/band-growth-decomposition.mjs --self-test

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

function gateTotalAt(ref) {
  let out;
  try {
    out = git(["ls-tree", "-r", "-l", ref, "--", "CLAUDE.md", "AGENTS.md", ".claude/rules/"]);
  } catch { return null; }
  let total = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const p = line.slice(tab + 1);
    const isRoot = p === "CLAUDE.md" || p === "AGENTS.md";
    const isRule = /^\.claude\/rules\/.+\.md$/.test(p);
    if (!isRoot && !isRule) continue;
    const size = Number(line.slice(0, tab).trim().split(/\s+/)[3]);
    if (Number.isFinite(size)) total += size;
  }
  return total;
}

// ── THE DISCRIMINATOR ────────────────────────────────────────────────────────────────────────
// Pure so the self-test can arm it against synthetic series (the real git walk is not the thing
// under test; the CLASSIFICATION is).
//   campaignShare  = fraction of total CUT volume landing on the single heaviest cut DAY
//   cutDayFraction = fraction of ACTIVE days carrying any cut at all
//   rateDelta      = |per-add-commit rate on cut days - rate on non-cut days| / overall rate
//
// CAMPAIGN  <=> cuts concentrated (few days, top-heavy) AND the add-rate is UNCHANGED on those
//               days — i.e. the campaign removed bytes without touching the write path.
// STRUCTURAL<=> cuts spread across most active days, OR the add-rate materially falls once
//               cutting starts (the write path itself changed).
export function classifyRegime({ campaignShare, cutDayFraction, rateDelta }) {
  // ⛔ DATA-PRESENCE ARM FIRST. `rateDelta` is null when one side of the
  // comparison has NO add-commits to average — "there is no rate" is not "the rate is zero".
  // Before this arm, a window with ZERO cuts gave rCut=0, so |0 - rNon| / rAll = 1.0, which
  // cleared the 0.35 threshold and returned WRITE-PATH-CHANGED — the anti-cap verdict — on a
  // window containing only additions, i.e. the pro-cap evidence. Reproduced:
  //   --pin=<sha> --since=2026-08-18  ->  "cuts present on 0% of active days" + WRITE-PATH-CHANGED.
  // Same family as bash-environment.md's SIXTH WAY: a no-data gate that returns a definite verdict.
  if (cutDayFraction === 0) return "no-cuts-in-window";
  if (rateDelta === null || rateDelta === undefined || Number.isNaN(rateDelta)) return "insufficient-data";
  if (cutDayFraction >= 0.6) return "structural-maintenance";
  if (rateDelta >= 0.35) return "write-path-changed";
  if (campaignShare >= 0.5) return "campaign";
  return "mixed";
}

function summarise(rows) {
  const withDelta = rows.filter((r) => r.delta !== null);
  const adds = withDelta.filter((r) => r.delta > 0);
  const cuts = withDelta.filter((r) => r.delta < 0);
  const sum = (a) => a.reduce((s, r) => s + r.delta, 0);

  const byDay = {};
  for (const r of withDelta) {
    const d = r.day;
    byDay[d] ??= { addN: 0, addB: 0, cutN: 0, cutB: 0 };
    if (r.delta > 0) { byDay[d].addN++; byDay[d].addB += r.delta; }
    else if (r.delta < 0) { byDay[d].cutN++; byDay[d].cutB += r.delta; }
  }
  const days = Object.keys(byDay).sort();
  const cutDays = days.filter((d) => byDay[d].cutN > 0);
  const cutTotal = Math.abs(sum(cuts)) || 1;
  const heaviestCutDay = cutDays.reduce((m, d) => (Math.abs(byDay[d].cutB) > Math.abs(byDay[m]?.cutB ?? 0) ? d : m), cutDays[0]);

  const rateOn = (ds) => {
    const n = ds.reduce((s, d) => s + byDay[d].addN, 0);
    const b = ds.reduce((s, d) => s + byDay[d].addB, 0);
    return n ? b / n : null;   // null = NO RATE (nothing to average), never 0
  };
  const nonCutDays = days.filter((d) => byDay[d].cutN === 0);
  const rAll = rateOn(days), rCut = rateOn(cutDays), rNon = rateOn(nonCutDays);

  const perDayRates = days.filter((d) => byDay[d].addN >= 3).map((d) => byDay[d].addB / byDay[d].addN);
  const mean = perDayRates.reduce((a, b) => a + b, 0) / perDayRates.length;
  const sd = Math.sqrt(perDayRates.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, perDayRates.length - 1));

  return {
    days, byDay, adds, cuts, withDelta,
    grossAdd: sum(adds), grossCut: sum(cuts), net: sum(withDelta),
    campaignShare: cutDays.length ? Math.abs(byDay[heaviestCutDay].cutB) / cutTotal : 0,
    cutDayFraction: days.length ? cutDays.length / days.length : 0,
    rateDelta: (rAll && rCut !== null && rNon !== null) ? Math.abs(rCut - rNon) / rAll : null,
    heaviestCutDay, rAll, rCut, rNon, mean, sd,
    cv: mean ? sd / mean : 0,
  };
}

function selfTest() {
  let fail = 0, ran = 0;
  const ck = (label, got, want) => {
    const ok = got === want;
    ran++;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: -> ${got} (expect ${want})`);
  };
  console.log("=== band-growth-decomposition --self-test ===");

  // classifyRegime: one RED control per branch. Mutation-valid — flip any threshold and exactly
  // the arm naming it goes RED (checked: >=0.6 -> >=0.9 REDs only "spread cuts"; >=0.5 -> >=0.9
  // REDs only "one-day campaign"; >=0.35 -> >=0.9 REDs only "add-rate collapsed").
  ck("one-day campaign, add-rate unchanged", classifyRegime({ campaignShare: 0.69, cutDayFraction: 0.33, rateDelta: 0.01 }), "campaign");
  ck("cuts spread over most days", classifyRegime({ campaignShare: 0.2, cutDayFraction: 0.8, rateDelta: 0.05 }), "structural-maintenance");
  ck("add-rate collapsed alongside cuts", classifyRegime({ campaignShare: 0.9, cutDayFraction: 0.3, rateDelta: 0.5 }), "write-path-changed");
  ck("neither concentrated nor spread", classifyRegime({ campaignShare: 0.3, cutDayFraction: 0.3, rateDelta: 0.05 }), "mixed");
  // DATA-PRESENCE arms. The first is the exact input that used to return
  // "write-path-changed": zero cuts makes rCut=0, so |0 - rNon| / rAll = 1.0 and the 0.35 threshold
  // clears. Both arms are DISCRIMINATING — delete the presence arms in classifyRegime and the first
  // returns "write-path-changed", the second "mixed" (checked by mutation, not asserted).
  ck("ZERO cuts -> no verdict, not write-path-changed", classifyRegime({ campaignShare: 0, cutDayFraction: 0, rateDelta: 1.0 }), "no-cuts-in-window");
  ck("rate unmeasurable on one side -> insufficient-data", classifyRegime({ campaignShare: 0.3, cutDayFraction: 0.3, rateDelta: null }), "insufficient-data");

  // summarise: a synthetic series with a known answer. NEGATIVE CONTROL is the point — a series
  // with NO cuts must not report a campaign, and must not divide by zero.
  const mk = (day, delta) => ({ day, delta, sha: "x", subj: "" });
  const noCuts = summarise([mk("d1", 100), mk("d1", 100), mk("d1", 100), mk("d2", 100), mk("d2", 100), mk("d2", 100)]);
  ck("negative control: no cuts -> campaignShare 0", noCuts.campaignShare, 0);
  ck("negative control: no cuts -> cutDayFraction 0", noCuts.cutDayFraction, 0);
  ck("negative control: constant adds -> CV 0", noCuts.cv, 0);
  const oneDay = summarise([
    mk("d1", 100), mk("d1", 100), mk("d1", 100),
    mk("d2", 100), mk("d2", 100), mk("d2", 100), mk("d2", -900),
    mk("d3", 100), mk("d3", 100), mk("d3", 100), mk("d3", -100),
  ]);
  ck("one heavy cut day dominates the cut volume", oneDay.campaignShare > 0.85, true);
  ck("net is add+cut, not the endpoint level", oneDay.net, 100 * 9 - 1000);

  // DERIVED, never a literal: a hardcoded "10 pass" shipped here over 9 checks on the first
  // draft — an instrument mis-reporting its own coverage, in a file about instrument soundness.
  console.log(fail ? `FAILED: ${fail} of ${ran} failed` : `OK: ${ran} pass / 0 fail`);
  return fail ? 1 : 0;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

// ── LIVE RUN ─────────────────────────────────────────────────────────────────────────────────
const PIN = arg("pin", "HEAD");
const SINCE = arg("since", "2026-08-05");
const pinSha = git(["rev-parse", PIN]).trim();

const merges = git(["log", "--first-parent", pinSha, `--since=${SINCE}`, "--merges", "--format=%H",
  "--", "CLAUDE.md", "AGENTS.md", ".claude/rules/"]).trim();
if (merges) {
  console.log(`⚠️  ${merges.split("\n").length} MERGE commits touch the band in this window — --first-parent deltas are unreliable. Read them by hand.`);
}

const raw = git(["log", "--first-parent", pinSha, `--since=${SINCE}`, "--format=%H\x1f%cI\x1f%s",
  "--", "CLAUDE.md", "AGENTS.md", ".claude/rules/"]).trim();
const commits = raw ? raw.split("\n").map((l) => { const [sha, iso, subj] = l.split("\x1f"); return { sha, iso, subj }; }).reverse() : [];

const rows = [];
for (const c of commits) {
  const cur = gateTotalAt(c.sha), par = gateTotalAt(`${c.sha}^`);
  rows.push({ ...c, day: c.iso.slice(0, 10), delta: cur === null || par === null ? null : cur - par });
}

const s = summarise(rows);
const regime = classifyRegime(s);
const level = gateTotalAt(pinSha);

console.log(`band-growth-decomposition · pin ${pinSha.slice(0, 9)} · since ${SINCE} · gate plane (orchestrator-EXCLUSIVE)`);
console.log(`  band level at pin: ${level} B   ·   band commits: ${rows.length}   ·   active days: ${s.days.length}`);
console.log("");
console.log(`  GROWTH commits ${String(s.adds.length).padStart(4)}   +${s.grossAdd} B     <- write path`);
console.log(`  CUT    commits ${String(s.cuts.length).padStart(4)}   ${s.grossCut} B     <- campaigns`);
console.log(`  NET                   ${s.net > 0 ? "+" : ""}${s.net} B`);
console.log("");
console.log(`  per-add-commit rate: mean ${s.mean.toFixed(0)} B · SD ${s.sd.toFixed(0)} · CV ${(100 * s.cv).toFixed(0)}%   (days with >=3 add-commits)`);
// `null` here means NO MEASUREMENT, not zero — print it as such rather than formatting a
// number that was never computed. Printing "0 B" is what let a zero-cut window read as a
// 100% rate delta and return the anti-cap verdict.
const B = (v) => (v === null || v === undefined ? "n/a (no add-commits on these days)" : `${v.toFixed(0)} B`);
const PCT = (v) => (v === null || v === undefined ? "n/a" : `${(100 * v).toFixed(1)}%`);
console.log(`     on CUT days ${B(s.rCut)}  ·  on NON-cut days ${B(s.rNon)}  ·  |delta|/overall ${PCT(s.rateDelta)}`);
console.log(`  cut concentration: ${s.heaviestCutDay === undefined ? "no cut days in window" : `heaviest cut day ${s.heaviestCutDay} carries ${(100 * s.campaignShare).toFixed(1)}% of all cut volume`}`);
console.log(`  cuts present on ${(100 * s.cutDayFraction).toFixed(0)}% of active days`);
console.log("");
console.log(`  REGIME: ${regime.toUpperCase()}`);
console.log("");
console.log(`  gross-add rate ${(s.grossAdd / s.days.length).toFixed(0)} B/active-day  <- the removal rate a flat-band policy must sustain FOREVER`);
console.log(`  net       rate ${(s.net / s.days.length).toFixed(0)} B/active-day  <- what actually happened, campaigns included`);
console.log("");
console.log("  ⛔ Quote BOTH rates or neither. The net rate alone is a claim about how often someone");
console.log("     runs a campaign; the gross-add rate alone ignores that campaigns do land.");
