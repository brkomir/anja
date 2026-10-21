#!/usr/bin/env node
/**
 * agent-memory-brief-split.mjs — the mechanism instrument behind a deferred tracker item,
 * built because deferring it further was not justified.
 *
 * Two modes, one predicate:
 *   PREDICATE  a dispatch brief "names the file" when the transcript head carries the agent's
 *              OWN family path `.claude/skills/<type>/MEMORY` — bare, backticked, bold, or a
 *              shard. NOT a phrase: the phrase key ("MEMORY.md first") matched 0/55 generated
 *              definitions and nudged a compliant brief. The corpus
 *              split: path named -> 0/39 NO_ATTEMPT; silent -> 33.0% (perfect separation).
 *   --corpus   [--since YYYY-MM-DD]  era x brief-names-path x outcome over the fleet jsonl
 *              corpus (reuses the shipped classifier). Era boundary 2026-08-01 = the day the
 *              expert-review template began mandating the read-first line. --since restricts
 *              to dispatches whose transcript mtime is on/after the date (the post-fix re-read).
 *   --ledger   the keep/kill read for the nudge hook, from .claude/logs/agent-memory-brief-
 *              fires.jsonl (one line per MEMORY.md-owning dispatch: haspath, fired). WITHIN-
 *              SESSION PAIRED: per session, haspath rate BEFORE its first fire vs AFTER. Never a
 *              pooled share — two sessions supply half the fleet's dispatches, so a pooled share
 *              moves ~9 points on one session's cadence with zero hook effect.
 *   --self-test  fixtures through the REAL exported symbols, with RED controls.
 *
 * This file was a session scratchpad. It is committed because a dated machine-fired trigger
 * whose instrument lives in a temp dir is a decorated never.
 */
import fs from "node:fs";
import path from "node:path";
import { isMain as isMainModule } from "./lib/is-main.mjs";
import { classifyDispatch, memoryPathFor, defaultProjectsDir } from "./agent-memory-load-audit.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MANDATE_CUTOFF = Date.parse("2026-08-01T00:00:00Z");

/** Does the brief name THIS agent's family path? Any spelling that contains the path counts. */
export function briefNamesPath(headText, agentType) {
  if (!agentType || /[\\/]/.test(agentType)) return false;
  return headText.includes(".claude/skills/" + agentType + "/MEMORY");
}

/** Parse ledger lines; drop synthetic; return rows {ts,type,sid,haspath,fired}. */
export function parseLedger(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.synthetic) continue;
    if (typeof r.haspath !== "number" || typeof r.fired !== "number") continue; // pre-field era rows
    rows.push(r);
  }
  return rows;
}

/**
 * Within-session paired read. For each session: rows in order; split at the FIRST fire.
 * before = haspath rate over rows strictly before the first fire (incl. none if it fires first);
 * after  = haspath rate over rows after it. Sessions with no fire contribute to `neverFired`.
 */
export function pairedFromLedger(rows) {
  const bySid = new Map();
  for (const r of rows) {
    if (!bySid.has(r.sid)) bySid.set(r.sid, []);
    bySid.get(r.sid).push(r);
  }
  const out = { sessions: [], neverFired: 0, pairedN: 0, meanBefore: null, meanAfter: null, improved: 0, worsened: 0, flat: 0 };
  let sb = 0, sa = 0;
  for (const [sid, list] of bySid) {
    const firstFire = list.findIndex((r) => r.fired === 1);
    if (firstFire === -1) { out.neverFired++; continue; }
    const before = list.slice(0, firstFire);
    const after = list.slice(firstFire + 1);
    if (!after.length) continue; // nothing observed after the nudge yet
    const rate = (xs) => (xs.length ? xs.filter((r) => r.haspath === 1).length / xs.length : null);
    const b = before.length ? rate(before) : 0; // the fire itself proves haspath was 0 at that point
    const a = rate(after);
    out.sessions.push({ sid, nBefore: before.length, nAfter: after.length, before: b, after: a });
    out.pairedN++; sb += b; sa += a;
    if (a > b) out.improved++; else if (a < b) out.worsened++; else out.flat++;
  }
  if (out.pairedN) { out.meanBefore = sb / out.pairedN; out.meanAfter = sa / out.pairedN; }
  return out;
}

function corpusMode(since) {
  const projectsDir = defaultProjectsDir(REPO);
  const sinceMs = since ? Date.parse(since + "T00:00:00Z") : null;
  const cells = {}; const bump = (k) => (cells[k] = (cells[k] ?? 0) + 1);
  let own = 0, total = 0;
  for (const sid of fs.readdirSync(projectsDir)) {
    const sub = path.join(projectsDir, sid, "subagents");
    if (!fs.existsSync(sub)) continue;
    for (const name of fs.readdirSync(sub)) {
      if (!name.endsWith(".meta.json")) continue;
      total++;
      let meta; try { meta = JSON.parse(fs.readFileSync(path.join(sub, name), "utf8")); } catch { continue; }
      const t = meta?.agentType ?? "";
      const memPath = memoryPathFor(REPO, t);
      if (!memPath || !fs.existsSync(memPath)) continue;
      const jsonl = path.join(sub, `agent-${name.slice("agent-".length, -".meta.json".length)}.jsonl`);
      let text, st; try { st = fs.statSync(jsonl); text = fs.readFileSync(jsonl, "utf8"); } catch { continue; }
      if (sinceMs && st.mtimeMs < sinceMs) continue;
      own++;
      const era = st.mtimeMs >= MANDATE_CUTOFF ? "post" : "pre";
      const named = briefNamesPath(text.slice(0, 16384), t) ? "path" : "nopath";
      const r = classifyDispatch(text, memPath);
      const o = r.cls === "NO_ATTEMPT" ? "NOATT" : r.cls === "ALT_READ" ? "ALT" : "READ";
      bump(`${era}|${named}|${o}`);
    }
  }
  console.log(`agent-memory-brief-split — corpus mode${since ? ` (since ${since})` : ""}: ${own} MEMORY.md-owning dispatches of ${total} meta files`);
  for (const era of ["pre", "post"]) {
    for (const named of ["path", "nopath"]) {
      const n = (o) => cells[`${era}|${named}|${o}`] ?? 0;
      const t = n("NOATT") + n("ALT") + n("READ");
      if (!t) continue;
      const pct = (x) => ((x / t) * 100).toFixed(1) + "%";
      console.log(`  ${era}-mandate · brief ${named.padEnd(6)} (n=${t}): READ ${n("READ")} (${pct(n("READ"))}) · ALT ${n("ALT")} (${pct(n("ALT"))}) · NO_ATTEMPT ${n("NOATT")} (${pct(n("NOATT"))})`);
    }
  }
  console.log("VERDICT: SPLIT-COMPLETE");
  return 0;
}

function ledgerMode() {
  const p = path.join(REPO, ".claude", "logs", "agent-memory-brief-fires.jsonl");
  if (!fs.existsSync(p)) { console.log("agent-memory-brief-split — ledger mode: NO LEDGER at " + p); return 1; }
  const rows = parseLedger(fs.readFileSync(p, "utf8"));
  const r = pairedFromLedger(rows);
  console.log(`agent-memory-brief-split — ledger mode: ${rows.length} real dispatch rows · ${r.pairedN} paired session(s) · ${r.neverFired} session(s) never nudged`);
  for (const s of r.sessions) console.log(`  ${s.sid}  before ${(s.before * 100).toFixed(0)}% (n=${s.nBefore}) -> after ${(s.after * 100).toFixed(0)}% (n=${s.nAfter})`);
  if (r.pairedN) console.log(`  paired mean haspath: before ${(r.meanBefore * 100).toFixed(1)}% -> after ${(r.meanAfter * 100).toFixed(1)}% · improved ${r.improved} · flat ${r.flat} · worsened ${r.worsened}`);
  else console.log("  no paired sessions yet — nothing to read (not a pass, not a fail)");
  console.log("VERDICT: LEDGER-READ-COMPLETE");
  return 0;
}

function selfTest() {
  let fail = 0;
  const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); if (!ok) fail++; };
  check("bare path names it", briefNamesPath("Read your .claude/skills/qa-expert/MEMORY.md first", "qa-expert"), true);
  check("backtick path names it (the live false-fire class)", briefNamesPath("Read `.claude/skills/qa-expert/MEMORY.md` first", "qa-expert"), true);
  check("shard path names it", briefNamesPath("grep .claude/skills/qa-expert/MEMORY-ARCHIVE-2026-07-20-2026-08-25.md", "qa-expert"), true);
  check("RED: another type's path does NOT name it", briefNamesPath("Read .claude/skills/uncle-bob/MEMORY.md first", "qa-expert"), false);
  check("RED: the bare phrase without a path does NOT name it", briefNamesPath("read your MEMORY.md first", "qa-expert"), false);
  check("RED: traversal-shaped type refused", briefNamesPath(".claude/skills/../x/MEMORY", "../x"), false);
  const ledger = [
    { ts: "t1", type: "a", sid: "S1", haspath: 0, fired: 1 },
    { ts: "t2", type: "a", sid: "S1", haspath: 1, fired: 0 },
    { ts: "t3", type: "a", sid: "S1", haspath: 1, fired: 0 },
    { ts: "t4", type: "b", sid: "S2", haspath: 1, fired: 0 },
    { ts: "t5", type: "b", sid: "S2", haspath: 1, fired: 0 },
    { ts: "t6", type: "c", sid: "S3", haspath: 0, fired: 1 },
    { ts: "t7", type: "c", sid: "S3", haspath: 0, fired: 0 },
    { ts: "syn", type: "c", sid: "S9", haspath: 0, fired: 1, synthetic: true },
  ];
  const parsed = parseLedger(ledger.map((r) => JSON.stringify(r)).join("\n"));
  check("synthetic rows dropped", parsed.length, 7);
  const r = pairedFromLedger(parsed);
  check("paired sessions", r.pairedN, 2);
  check("never-fired sessions", r.neverFired, 1);
  check("S1 improved after nudge (0 -> 1.0)", r.sessions.find((s) => s.sid === "S1")?.after, 1);
  check("S3 flat after nudge (0 -> 0)", r.sessions.find((s) => s.sid === "S3")?.after, 0);
  check("improved/flat tally", [r.improved, r.flat, r.worsened], [1, 1, 0]);
  console.log(fail ? `self-test: ${fail} FAILED` : "self-test: OK");
  return fail ? 1 : 0;
}

// POLARITY: realpathed correctly but fell back to `false` on an unresolvable argv[1]; a gate
// must never resolve an undecidable entrypoint to "don't run". SSOT: scripts/lib/is-main.mjs.
if (isMainModule(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.includes("--self-test")) process.exit(selfTest());
  else if (a.includes("--ledger")) process.exit(ledgerMode());
  else if (a.includes("--corpus") || a.length === 0) { const i = a.indexOf("--since"); process.exit(corpusMode(i >= 0 ? a[i + 1] : null)); }
  else { console.error("usage: agent-memory-brief-split.mjs [--corpus [--since YYYY-MM-DD] | --ledger | --self-test]"); process.exit(2); }
}
