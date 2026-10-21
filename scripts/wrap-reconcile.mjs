#!/usr/bin/env node
// wrap-reconcile.mjs — deterministic /wrap completeness reconciler (enforce layer).
//
// The recurring failure (3+ occurrences): the orchestrator SUBSETS an
// enumeration step — persists M of N emitted `### Memory Update` blocks, skips a
// mechanically-fired mandatory step — then self-certifies "wrap complete." The
// checkmark is ASSERTED, not COMPUTED. This script COMPUTES it from ground truth
// (the session transcript + git), so the count can't be vibed.
//
// review convergence (2026-07-01):
// BOTH sides are on disk → emitted-vs-persisted is a deterministic set-difference.
// Emitted = `### Memory Update` blocks in the session transcript (agents emit them
// in their returns; background-agent returns land in the transcript via task
// notifications, so the transcript is the ground truth — NOT the orchestrator's
// in-context count, which is exactly what gets subsetted). Persisted = `## <date>`
// headers appended to *MEMORY.md this session (git diff vs the session-start anchor).
//
// STATUS: WARN-MODE (exit 0 always). Do NOT flip to block-mode until it has run
// clean across ~5 real wraps (the review convergence). The emitted
// side was RE-BASED 2026-07-01 after a first-cut raw-transcript grep over-counted
// 33 vs a ground-truth ~10 (the transcript CONTAINS the loaded SKILL.md specs that
// DESCRIBE `### Memory Update` + the `sed … wrap-dp-<i>.jsonl` deep-pass signature,
// plus the orchestrator's own quoting — raw grep can't tell "spec describes X" from
// "X happened"). FIX: count from the PER-AGENT `<tasksDir>/<id>.output` files
// (one file = one agent's OWN return, no spec/quote pollution), mtime-windowed to
// this wrap. Re-smoke landed 4 emitted vs 18 persisted → no false delta (was 33).
// RESIDUAL calibration (why still warn-only): (a) the mtime window depends on a
// real session-start anchor (session-start.sh now stamps it) — a manual --anchor
// is smoke-only; (b) the "None — no significant decisions" tail-match + the 12KB
// tail size need tuning across wraps; (c) the ephemeral /private/tmp tasks dir may
// be GC'd on a long session; (d) content-match uses a 40-char normalized title
// slice — a block whose header is REWORDED at persist time can read as unpersisted
// (false delta, warn-safe direction). The PERSISTED side was RE-SCOPED 2026-07-03:
// the prior `git diff ${anchor}..HEAD` counted EVERY fleet session's
// commits (all same git-user), so a heavy-persisting peer inflated the count and
// masked THIS session's unpersisted blocks (printed "no delta" while 4 were
// unsaved). Now it CONTENT-matches this session's emitted block headers against
// the memory files (session-scoped), with the old fleet-wide git-diff kept ONLY as
// a flagged fallback when the emitted side is blind. Block-mode promotion + a
// Stop-hook wiring = the calibrated follow-up (the review's recommendation),
// gated on the clean-warn window.
// Usage: node scripts/wrap-reconcile.mjs [--transcript <path>] [--anchor <sha>] [--json]

import { readFileSync, existsSync, readdirSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { smokeSkippedProbes } from "./lib/wrap-reconcile-smoke-skip.mjs";

// Repo root, anchored to THIS FILE — never the cwd. A hook's cwd is not guaranteed
// (`settings.json` anchors a hook's SCRIPT PATH, not its working directory), and the smoke suite
// runs from the repo root, so a cwd-relative path is a bug no test here can ever catch. Same
// class as `meta-corrections-scan.py`'s `DEFAULT_REGISTRY`.
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// STAGE-1 CORPUS — ONE definition, consumed by the reconcile path AND by self-test arm (9).
// Extracted deliberately: a self-test that builds its own `cat` is a REPLICA, and this file already
// records what replicas cost ("two copies existed and breaking the runtime one left the suite ALL
// PASS"). With one definition, unstarring `MEMORY*.md` here breaks production AND reds arm (9).
// ⛔ THIS IS THE SET THE **EXACT** MATCHER SEARCHES, AND UNTIL 2026-08-13 IT WAS MEMORY FILES
// ONLY — while the comments downstream advertised a "WIDENED durable-home set (memory + rules +
// DECISIONS.md + todo.txt + docs)". That widening was real but applied ONLY to the shingle
// FALLBACK; the primary matcher never saw any of it. Two pathspecs, one of them documented, and
// the documented one was not the one doing the work.
//
// Measured 2026-08-13: 6 accused / 6 actually persisted — a 100% false-accusation run. The six
// landed in AGENTS.md (+18 and +2), the corrections registry (+8), two SKILL.md specs, a script
// and a plans artifact. `AGENTS.md` is the always-loaded behavioural spec every seat reads on
// every turn, so the lessons MOST likely to be codified there — rules binding every session —
// were the class this gate could NEVER credit.
//
// Direction is why it matters: a false ACCUSATION on the one gate whose job is to stop a wrap
// self-certifying. Six-for-six teaches the reader that the delta is noise, which is the cry-wolf
// death of the net. Same representation-anchored class as the MEMORY*.md miss below.
//
// The bar is UNCHANGED: credit still requires a ≥8-char normalized 40-char header slice to appear
// verbatim in this corpus. Widening WHERE that proof may be found does not weaken WHAT counts as
// proof. Scoped to durable PROSE homes; `scripts/` and `plans/` stay with the shingle fallback,
// where a 4-word body match is the appropriate instrument for a non-prose artifact.
// `|| true`: `cat` exits 1 when ANY listed file or glob is absent, execSync then throws, and the catch
// returned "" for the WHOLE corpus — one missing member blinded the exact matcher. Self-test arm (9c).
function buildMemoryCorpus(root = REPO_ROOT) {
  try {
    return execSync(
      `cat .claude/skills/*/MEMORY*.md .claude/project-memory/*.md ` +
        `.claude/rules/*.md '.claude/skills'/*/SKILL.md '.claude/skills'/*/references/*.md .claude/orchestrator/*.md ` +
        `.claude/docs/*.md .claude/meta-corrections-registry.md ` +
        `AGENTS.md CLAUDE.md DECISIONS.md todo.txt 2>/dev/null || true`,
      { cwd: root, encoding: "utf8", maxBuffer: 80 * 1024 * 1024 },
    );
  } catch { return ""; }
}

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const asJson = args.includes("--json");

// Normalize a header slice for content-matching. Strips JSONL escapes — incl.
// `\uXXXX` (an em-dash `—` in a header serializes to `—` in the transcript
// but is a real `—` in the .md, so both must collapse to the same token) and
// `\n`/`\t`/`\"` — then punctuation → space, so the transcript side and the
// on-disk side normalize identically.
const norm = (s) => s.toLowerCase().replace(/\\u[0-9a-f]{4}/gi, " ").replace(/\\[nt"]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
// norm() over the whole durable-home corpus (42.5 M chars, 2026-10-06) peaked at 1.8 GB RSS and 2.2 s CPU per
// run, all in its regex intermediates. Normalised in newline-bounded chunks the result is byte-identical (a newline
// is itself a separator, and no escape norm strips spans one) at about 0.55 GB and 1.05 s. Self-test arm (1c).
const normChunked = (s, size = 1 << 20) => {
  const parts = [];
  for (let i = 0; i < s.length; ) {
    let j = Math.min(s.length, i + size);
    if (j < s.length) { const nl = s.indexOf("\n", j); j = nl < 0 ? s.length : nl + 1; }
    const part = norm(s.slice(i, j));
    if (part) parts.push(part);
    i = j;
  }
  return parts.join(" ");
};

// 4-word body shingles over normalized text (the
// measured winner: TP 12-23% of shingles hit the delegator's diff, disjoint control 0-1%).
// Words ≤2 chars dropped (stopword-ish noise inflates false hits on "is a of the" runs).
const bodyShingles = (bodyNorm) => {
  const words = bodyNorm.split(" ").filter((w) => w.length > 2);
  const out = new Set();
  for (let i = 0; i + 4 <= words.length; i++) out.add(words.slice(i, i + 4).join(" "));
  return [...out];
};

// MOVED TEXT IS NOT NEW TEXT. `git diff` is per-file, so a block
// moved VERBATIM between two durable homes (a spec split into references/, a MEMORY roll into a
// shard) reads as a `-` in one file and a `+` in the other, and that `+` then credits any emitted
// block that merely QUOTES the moved text. Measured on one such split: a never-persisted
// correction lesson quoting one sentence of wrap 5d went accused -> LIKELY-REWRITTEN (24/138).
// Evidence is a shingle ADDED in the window and not REMOVED in it. A lesson persisted in-window
// and THEN moved keeps its credit: it was never a `-` line, because it was not there at the anchor.
const addedEvidenceShingles = (diffOut) => {
  const side = (c, hdr) => norm(diffOut.split("\n").filter((l) => l.startsWith(c) && !l.startsWith(hdr)).join("\n"));
  const removed = new Set(bodyShingles(side("-", "---")));
  return new Set(bodyShingles(side("+", "+++")).filter((sh) => !removed.has(sh)));
};

// SLICE → SOURCE, the inverse the accusation used to lack (2026-09-07).
// Module-scope so the self-test consumes the REAL symbol rather than a copy: the
// accusation prints a normalized 40-char slice, and without this the reader has nothing to
// grep for — measured, three independent probes failed to map one slice back to its block.
const srcFor = (blocks, h) => blocks.find((b) => b.headerSlice === h)?.src ?? "(source unknown)";

// Verdict derivation — module-scope so the self-test consumes the REAL symbol.
// REVIEW: ≥1 LIKELY-REWRITTEN downgrade with zero hard findings
// must NOT read CLEAN — the downgrade emptied `accused`, so without this tier the fuzzy
// matcher could silently green the very verdict it subsetted. ok: is CLEAN-only.
const deriveVerdict = (nBlind, nFindings, nLikely) =>
  nBlind ? "BLIND" : nFindings ? "DELTA" : nLikely ? "REVIEW" : "CLEAN";

// ── DEEP-PASS COVERAGE (2026-08-16) ─────────────────────────────────────────────
// `deepPassRan` answers "did a deep pass HAPPEN". It CANNOT answer "did it COVER THE
// PLAN", because it is a single boolean regex: ONE `sed -n 'A,Bp'` extraction satisfies
// it. Measured on this seat's own wrap 2026-08-15 — a 12-slice plan, wave 1 clamped to
// the concurrency ceiling of 10, wave 2 never fired, ~1,020 lines (the session's final
// build AND the wrap itself) never scanned — and the gate printed `fired=true ran=true`.
// The spec's own mandated cross-check does not close it either and reads like it does:
// `slices total == wc -l $TXT` verifies the PLAN is arithmetically complete, which is a
// property of the plan FILE, not of what was launched. Mine passed at 8658 = 8658.
//
// ⛔ WHY A UNION-COVERAGE CHECK WOULD NOT WORK, since it is the obvious first idea:
// an under-dispatched wave leaves NO HOLE below the highest dispatched line — the
// missing slices' `sed` commands simply never appear, so the union of what DID run is
// gapless and the shortfall sits ABOVE it, indistinguishable from "the transcript grew".
// The plan's SIZE has to be stated by the planner; it cannot be recovered from the runs.
//
// ⛔ AND THE DETECTOR MUST NOT MATCH THE SPEC THAT DOCUMENTS IT. wrap/SKILL.md is loaded
// into the very transcript this regex scans, so a worked example carrying real digits
// would satisfy the gate on every wrap, including one that dispatched nothing. Same trap
// the `wrap-dp-<i>` comment below already guards: the spec writes the count as a BRACKET
// PLACEHOLDER, and `\d+` cannot match `<`. Keep it that way in both files.
// ⛔ DISPATCHED IS READ FROM THE HARNESS DISPATCH LEDGER, NEVER FROM THE TRANSCRIPT. Until
// 2026-09-14 it counted distinct `sed -n A,Bp` ranges in the raw transcript, which counts
// the orchestrator's own file reads: 92 ranges on one session of which 85 were ordinary Bash
// reads and 7 real dispatches, and 855 and 569 on two other sessions against plans of 1-28,
// so the shortfall branch could never fire. The ledger is
// written by the PreToolUse memory guard on every `Agent` call, so a seat cannot add a record
// by discussing a slice, and planned and dispatched are now two different witnesses.
// Scoped by session AND by time (records at or after the plan statement's second), because
// it is a many-writer file and a re-wrapped session dispatches once per wrap.
// ⚠️ Stated limits: (a) it records ATTEMPTS, so a call allowed here that then failed to start
// still counts — only a separate start ledger records starts, and it carries no description;
//     the two ledgers share no per-dispatch key (0 of 2,459 start records join on `agent_id`), so
//     the reachable half is a COUNT diff of attempts vs starts per session inside one wave's time
//     window — it can show that an outage lost a slice, never which one, and read day-wide it is
//     noise, because a resumed agent starts with no attempt row;
// (b) the slice is identified by the dispatcher's own `description`, so a slice agent named
// without "deep-pass slice"/"deep-scan slice" is invisible and reads as a shortfall (the loud
// direction); (c) one agent covering several slices counts once, also the loud direction.
const DP_LEDGER = ".claude/logs/agent-dispatch-memory.jsonl";
const DP_SLICE_ID_RE = /\bdeep[- ]?(?:pass|scan)\b.*?\bslices?[\s-]+([a-z]?\d+(?:-\d+)?|[a-z])\b/i;
const dpSliceId = (agent) => {
  const m = String(agent || "").match(DP_SLICE_ID_RE);
  return m ? m[1].toLowerCase().replace(/^0+(?=\d)/, "") : null;
};
const dpLedgerDispatches = (ledgerLines, sessionId, sinceMs) => {
  const ids = new Set();
  let denied = 0;
  const floor = Math.floor(sinceMs / 1000) * 1000;   // ledger stamps whole seconds
  for (const l of ledgerLines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (!r || r.sid !== sessionId || r.synthetic) continue;
    const ms = Date.parse(r.ts);
    if (!Number.isFinite(ms) || ms < floor) continue;
    const id = dpSliceId(r.agent);
    if (id == null) continue;
    if (r.decision === "deny") { denied++; continue; }
    ids.add(id);   // a retried slice collapses onto its id
  }
  return { dispatched: ids.size, denied };
};
// ⛔ AND IT MUST NOT MATCH THE PLANNER'S OWN PROBES. Until 2026-09-14 this read `raw`, so a
// grep FOR the plan line satisfied the gate that asks whether the line was stated: in
// one session's first wrap the only two matches were that seat's own `grep -c -F` tool_use
// and a tool_result echoing a fixture from this file, no assistant text ever carried the
// line, and the run printed "no completeness delta". The planner states the line OUT LOUD,
// so the corpus is ASSISTANT TEXT blocks only, and the LAST statement wins, because a
// re-wrapped session states one plan per wrap and the first one is a previous run's.
const dpAssistantText = (lines) => lines.map((l) => {
  try {
    const r = JSON.parse(l);
    const c = r.type === "assistant" ? r.message?.content : null;
    return Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
  } catch { return ""; }
}).join("\n");
// The format admits what live statements carry between the colon and the count — spaces,
// `**`, a backtick, `_` — and the singular. Five real statements were unmatchable under
// `:\s*(\d+)\s+slices`, one of them the founding instance of this fix. A bracket
// placeholder still cannot match, because `<` is outside the class.
const DP_PLAN_RE = /wrap-dp-plan:[\s*_`]*(\d+)[\s*_`]*slices?\b/g;
const dpPlannedSlices = (text) => {
  const all = [...String(text).matchAll(DP_PLAN_RE)];
  return all.length ? Number(all[all.length - 1][1]) : null;
};
// The LAST plan stated in an assistant TEXT block, with that record's timestamp, which
// scopes the ledger read. The `type === "assistant"` test is load-bearing on its own: a
// `user` record carrying a plain text block holds the same shape (live in 21 of 53
// sessions) and must not count. THINKING blocks are excluded on purpose — a plan formed
// only in thinking was never stated, and the planner is told to state it in the reply.
// ⚠️ Known limits, stated rather than hidden: a later reply that QUOTES the line with real
// digits replaces the real plan (last match), and so does one NEGATING it ("I could not
// find any such line"). A record-type filter cannot tell a statement from a discussion of
// it. Last match is still right on balance: one session stated 15 distinct plans, and first
// match would have handed wrap 15 wrap 1's number.
const dpPlanScan = (lines) => {
  let n = null, ms = NaN;
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    const c = r && r.type === "assistant" ? r.message?.content : null;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "text") continue;
      const hit = dpPlannedSlices(b.text);
      if (hit != null) { n = hit; ms = Date.parse(r.timestamp); }
    }
  }
  return { n, ms };
};
// A shortfall is only a DEFECT when it is SILENT. wrap/SKILL.md makes a declared partial a
// first-class outcome ("partial + honest beats complete + stalled") — so a wrap that names
// its unread region gets an informational note, not an accusation. Flagging an honest
// partial is how a reader learns to ignore this line.
// Same self-match guard: the spec writes the region with LETTER placeholders, so requiring
// DIGITS is what stops the documentation from silencing the gate it documents.
const dpDeclaredResidue = (text) =>
  /line region \d+\s*[-–—]\s*\d+ unscanned/i.test(String(text));
// A pass that `/deep-pass`'s --sonnet stop HALTED dispatched one slice, so `deepPassRan` (two or more
// dispatches, or a slice artifact in a tool call) reads false and the SKIPPED finding would tell the
// seat to redo what the owner halted. A stated plan line plus a declared unread region is a declared
// halt, reported as a note. Both halves are required: no plan or no declared region stays SKIPPED.
// Module scope so the self-test consumes the real function.
const dpSkipVerdict = ({ fired, ran, planned, declared }) =>
  !fired || ran ? null : (planned != null && declared ? "halted" : "skipped");
// ── THE PLAN'S SECOND SOURCE: THE SAVED SLICE REPORTS (2026-09-30) ──
// Reply text written before a tool call does not always reach the transcript: of 9 mid-turn
// replies one wrap wrote, 5 were absent, its plan line among them.
// So `dpPlanScan` can return null on a
// pass that DID state its plan, and the coverage check read BLIND. /deep-pass writes one
// `<scratchpad>/dp-returns-<epoch-s>/slice-NN.md` per slice at dispatch — `range: a-b` plus
// `status: dispatched`, overwritten by the report on arrival — and those files survive the
// `rm -rf` of the slice dir. They are the fallback, never the primary: they are written per
// DISPATCH, so a whole wave that was never dispatched leaves no file and this plane cannot see
// it. That limit is printed with every reading taken from here.
// ⛔ BOTH SOURCES ARE SCOPED TO THE CURRENT WRAP. A re-wrapped session holds one returns dir and
// one plan line per wrap, and the previous wrap's would otherwise stand in for this one's: its
// count as the plan, and its ledger window reaching back over both waves (an OVERcount, the
// direction that passes a shortfall). The boundary is the LAST /wrap invocation in the
// transcript — this run's, since the reconcile runs inside the wrap. No boundary ⇒ no fallback,
// and the primary keeps its old unscoped behaviour.
// The marker literals are concatenated so a transcript quoting this file cannot supply one.
const DP_WRAP_CMD = "<command-" + "name>/wrap</command-" + "name>";
const DP_WRAP_BASE_RE = new RegExp("^Base directory for this skill: [^\\n]*/\\.claude/skills/wrap\\n");
const DP_WRAP_LOADED = "Skill /wrap is already " + "loaded above";
const dpLastWrap = (lines) => {
  let ms = NaN, idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (!r || r.type !== "user" || r.isCompactSummary) continue;
    const c = r.message?.content;
    let text;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      if (c.some((b) => b?.type === "tool_result")) continue;   // a probe's output, never an invocation
      text = c.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
    } else continue;
    const hit = r.isMeta
      ? DP_WRAP_BASE_RE.test(text) || text.startsWith(DP_WRAP_LOADED)
      : text.includes(DP_WRAP_CMD);
    if (hit) { const t = Date.parse(r.timestamp); if (Number.isFinite(t)) { ms = t; idx = i; } }
  }
  return { ms, idx };
};
const dpLastWrapMs = (lines) => dpLastWrap(lines).ms;
// The transcript's line count when the pass began: the last record stamped at or before runMs.
// Slice ranges number the STRIPPED copy, which blanks payloads and keeps every line, so the two
// line spaces agree.
const dpLinesAt = (lines, runMs) => {
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    let r;
    try { r = JSON.parse(lines[i]); } catch { continue; }
    const t = Date.parse(r?.timestamp);
    if (Number.isFinite(t) && t <= runMs) n = i + 1;
  }
  return n;
};
// The un-fired-wave check the note used to leave to the reader:
// a wave never dispatched leaves no stub, so it shows up only as the last saved range stopping
// short of the transcript the pass was cut from. Flag a shortfall wider than a median slice.
// Measured slack on 3 sessions: 25 / 51 / 247 lines against slice widths of ~590-710; N=3, so the
// threshold is a first guess and the check is warn-mode like everything else here. No verdict
// when a range did not parse — the span is then unverified, which the note already says.
const dpUnfiredSlack = (linesAtRun, file) => {
  if (!file || file.last == null || file.noRange.length || !file.medianWidth || !linesAtRun) return null;
  const slack = linesAtRun - file.last;
  return { slack, width: file.medianWidth, flagged: slack > file.medianWidth };
};
// The newest `dp-returns-<epoch-s>` run token created at or after the wrap began; null when none.
// One second of slack: the token is whole seconds and the wrap record carries milliseconds.
const dpCurrentReturnsRun = (tokens, wrapMs) => {
  if (!Number.isFinite(wrapMs)) return null;
  const ok = tokens.filter((t) => Number.isFinite(t) && t * 1000 >= wrapMs - 1000).sort((a, b) => a - b);
  return ok.length ? ok[ok.length - 1] : null;
};
// entries: [{ name, text }] for the files of ONE returns dir. Returns null when no slice file
// parses, so an empty dir (19 of 53 on this box, 2026-09-30) stays BLIND, never a plan of 0.
const dpReturnsPlan = (entries) => {
  const slices = [];
  for (const { name, text } of entries) {
    if (!/^slice-\d+\.md$/.test(name)) continue;
    const head = String(text).split("\n").slice(0, 6).join("\n");
    // Tolerant on purpose: live stubs read "range: 8208-9073", "range: transcript lines 5367-6030",
    // "range: stripped lines 1-362 (…)", "range: lines 1-286". A range it still cannot parse is
    // UNVERIFIED (a note), never a finding (the strict form raised
    // a false re-dispatch finding on 4 of the 6 real sessions where this fallback activates).
    const rm = head.match(/^range:?\s*(?:[a-z ]*?\blines?\s+)?(\d+)\s*[-–]\s*(\d+)\b/im);
    const sm = head.match(/^status:\s*(\S+)/im);
    slices.push({ name, range: rm ? [Number(rm[1]), Number(rm[2])] : null, status: sm ? sm[1] : null });
  }
  if (!slices.length) return null;
  const ranges = slices.filter((s) => s.range).map((s) => s.range).sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] !== ranges[i - 1][1] + 1) gaps++;
  const widths = ranges.map(([a, b]) => b - a + 1).sort((x, y) => x - y);
  return {
    medianWidth: widths.length ? widths[Math.floor(widths.length / 2)] : null,
    n: slices.length,
    first: ranges.length ? ranges[0][0] : null,
    last: ranges.length ? Math.max(...ranges.map((r) => r[1])) : null,
    gaps,
    noRange: slices.filter((s) => !s.range).map((s) => s.name),
    pending: slices.filter((s) => /^dispatched$/i.test(s.status ?? "")).map((s) => s.name),
  };
};
// Module scope so the self-test reaches them: as inline main-body
// logic, reverting the per-wrap scoping, the slice-files leg, or putting noRange back into the
// finding condition all left the self-test green — and the last one is the false "Re-dispatch"
// on folders carrying an unparsed range, which this fix removed.
const dpRanThisWrap = (lines, wrap, filePlan) => {
  const s = Number.isFinite(wrap.ms) && wrap.idx >= 0 ? lines.slice(wrap.idx) : lines;
  return deepPassArtifactInToolUse(s) || deepPassDispatchCount(s) >= 2 || (filePlan != null && filePlan.n >= 1);
};
// Only a slice that never returned, or a gap between ranges that ALL parsed, is a finding; a range
// that did not parse makes the span unverified, which is a note.
const dpFileIncomplete = (file) => file.pending.length > 0 || (file.gaps > 0 && !file.noRange.length);
// The transcript plan wins when it belongs to this wrap; otherwise the file plan, else nothing.
// A transcript plan stated BEFORE the wrap began is the previous wrap's and is not used.
const dpChoosePlan = ({ transcript, wrapMs, file, fileRunMs }) => {
  const current = (ms) => !Number.isFinite(wrapMs) || (Number.isFinite(ms) && ms >= wrapMs - 1000);
  if (transcript.n != null && current(transcript.ms)) return { source: "transcript", n: transcript.n, ms: transcript.ms };
  if (file && Number.isFinite(fileRunMs)) return { source: "file", n: file.n, ms: fileRunMs, file };
  return { source: null, n: null, ms: NaN };
};

// ── DURABLE-HOME SET (2026-08-25) ───────────────────────────────────────────────
// Module scope so the SELF-TEST CONSUMES THE REAL VALUE — inlined in the template literal
// it was unpinnable, and an inlined constant is exactly the "replica" shape this file's own
// MODULE-SCOPE PROBE PRIMITIVES note was written about.
// ⛔ WHY IT NEEDED PINNING. This set once omitted `AGENTS.md`, and the tool reported
// 6 emitted / 0 persisted while all six had in fact landed — `AGENTS.md` among them. It is
// the single most load-bearing always-loaded file in the repo, so the class of lesson MOST
// likely to be codified there (a behavioural obligation binding every seat) was exactly the
// class the matcher would always report as dropped. The cost is not a missed persist: it is
// that a 6/6 false alarm trains the reader to discount the delta, which is the one finding
// this tool exists to produce. Widened and, until now, guarded by NOTHING —
// zero self-test arms named the pathspec, so the fix could regress in silence.
// WIDENING DOES NOT WEAKEN THE EVIDENCE BAR: credit still requires a 4-word BODY shingle
// against ADDED lines. This only changes WHERE that proof may be found.
const DURABLE_HOMES = [
  "'.claude/skills/*/MEMORY*.md'", "'.claude/project-memory/*.md'", "'.claude/rules/*.md'",
  "DECISIONS.md", "todo.txt", "'.claude/docs/*.md'", "AGENTS.md", "CLAUDE.md",
  "'.claude/skills/*/SKILL.md'", ".claude/meta-corrections-registry.md",
  // Added 2026-09-26 with the wrap + expert-review split: both specs moved dated narrative,
  // evidence and conditional-step bodies VERBATIM into their references/ dirs, and that is
  // exactly the text a lesson codified into a spec lives in. Without this entry (and the
  // matching glob in buildMemoryCorpus) a lesson persisted into a spec, then moved, reads as
  // never persisted. Same bar, wider home — the 2026-08-13 AGENTS.md reasoning above.
  "'.claude/skills/*/references/*.md'",
  "'.claude/orchestrator/*.md'", "'.claude/hooks/*.sh'", "'scripts/*'", "'plans/*.md'",
  // Added 2026-09-07, and MEASURED before being kept (the locale entry below is the template
  // for why a path addition is not self-justifying). `scripts/*` was here and `src/`+`tests/`
  // were not, so a DESIGN-PANEL block whose substance ships as PRODUCTION CODE was unmatchable
  // by construction — which is the dominant accused class on a feature-building session, not an
  // edge case. Found by opening an accused block at the source the new citation now names: a
  // design-panel seat prescribing a per-claim-type gate map, whose three most
  // distinctive prose phrases grep ZERO across every prior home while its two coined symbols,
  // `centreOffset` and `minEdgeBand`, live in 12 and 8 `src/` files. MEASURED delta on this
  // session, same anchor: accused **13 → 7**, likely-rewritten **39 → 45** — six blocks credited
  // with receipts, where the locale addition below moved the delta by exactly zero. It is not
  // free: it took the run to 146 s and needed the shingle-pass Set below to stay usable.
  "'src/**'", "'tests/**'",
  // Added 2026-09-01. Localisation work's durable home IS a locale bundle —
  // the finding is a word choice and the only place a word choice can land is
  // messages/<locale>.json — so the path belongs here on principle.
  // ⛔ BUT IT DOES NOT FIX THE LOCALE FALSE-ACCUSATION, AND MEASURING SAID SO: adding it moved
  // the delta by ZERO (57 emitted / 21 persisted / 29 accused, before and after). The bundles
  // are in range and full of added lines, but an added line reads `"pet": "Animali domestici"`
  // while the block's BODY is English prose explaining the choice. The evidence bar is a 4-word
  // BODY shingle against added lines, so a prose shingle cannot match a translated string value
  // BY CONSTRUCTION. Path scope was necessary and nowhere near sufficient.
  // Kept because it is correct and free — a block that happens to quote its chosen string
  // verbatim now matches — but do NOT read this entry as closing the locale gap. The real fix
  // is a different evidence rule for value-bearing homes.
  "'messages/*.json'",
];
const DURABLE_HOME_PATHSPEC = DURABLE_HOMES.join(" ");
// ── HOME CLASS (2026-10-10). The shingle receipt answers "did this block's prose land in ANY
// durable home" — and the durable set deliberately includes plans/, src/, tests/, scripts/ and hooks, so a
// panel seat's report copied VERBATIM into a plans/ verdict record, or a brief's prose quoted into a
// script comment, earned the same LIKELY-REWRITTEN credit as a reworded MEMORY row. Measured on one
// wrap: 44 blocks credited LIKELY-REWRITTEN at overlaps from 14/276 to 676/863; a phrase grep over the
// expert MEMORY dirs read 0 for 43 of them (the 44th matched a generic path string), and the one block
// whose reworded copy WAS committed to a MEMORY shard sat at 30/290 — below most of the false credits.
// The RATIO is not the discriminator; the HOME is. So the evidence is split by class: a hit in a
// memory-class home (MEMORY shards, project-memory, rules, DECISIONS, todo, docs, the always-loaded specs,
// SKILL specs and references, orchestrator, the corrections registry) credits LIKELY-REWRITTEN; a hit
// ONLY in an artifact-class home (plans, src, tests, scripts, hooks, locale bundles) reads
// ECHOED-IN-ARTIFACT and the block stays UN-PERSISTED, with the receipt printed so the reader sees what
// echoed it. The threshold is unchanged — raising it would have dropped the 30/290 true persist before
// any of the 257/444 false ones. The 2026-09-07 src/tests widening is kept as EVIDENCE OF AN ECHO, not
// as credit: a design-panel block whose substance shipped as code is still absent from the expert's
// memory, which is what the next seat of that expert reads.
const ARTIFACT_HOMES = new Set(["'scripts/*'", "'plans/*.md'", "'src/**'", "'tests/**'", "'messages/*.json'", "'.claude/hooks/*.sh'"]);
const MEMORY_CLASS_PATHSPEC = DURABLE_HOMES.filter((h) => !ARTIFACT_HOMES.has(h)).join(" ");
const ARTIFACT_CLASS_PATHSPEC = DURABLE_HOMES.filter((h) => ARTIFACT_HOMES.has(h)).join(" ");
// Threshold sits between the measured populations (TP 12-23%, disjoint control 0-1%), with absolute
// floors so a tiny block cannot qualify on 1-2 coincidental runs. Module scope: the runtime loop and the
// self-test consume this ONE function.
const SHINGLE_MIN = 20, HITS_MIN = 5, RATIO_MIN = 0.05;
function classifyShingleEvidence(shingles, memorySet, artifactSet) {
  const clears = (hits) => shingles.length >= SHINGLE_MIN && hits.length >= HITS_MIN && hits.length / shingles.length >= RATIO_MIN;
  const mem = shingles.filter((s) => memorySet.has(s));
  if (clears(mem)) return { verdict: "rewritten", hits: mem.length, sample: mem[0] };
  const art = shingles.filter((s) => artifactSet.has(s));
  if (clears(art)) return { verdict: "echoed", hits: art.length, sample: art[0] };
  return { verdict: "none", hits: Math.max(mem.length, art.length), sample: null };
}
// ── LENS-OWN CREDIT (2026-10-10). The home-class split above still
// credited LIKELY-REWRITTEN from ANY memory-class file, so a seat's prose reworded into a todo row (17/51
// shingles), a meta L-entry (18/51) or a review-ledger row (19/49) earned the credit while the block was
// absent from the expert's own memory — the one file that expert's next seat reads. When the block's source
// names its expert (the subagents store writes `agent-<id>.meta.json` with `agentType` beside each
// transcript) and that expert has a MEMORY file, only hits in `.claude/skills/<expert>/MEMORY*.md` credit;
// every other hit, memory-class or artifact-class, reads ECHOED (reported, never credited). A block with no
// resolvable expert (a task `.output`, a general-purpose seat, a type with no MEMORY file) keeps the
// memory-class credit, because its durable home can legitimately be meta, project-memory or the rules.
// Module scope, so the self-test and the runtime loop consume these two functions.
function lensOfSrc(src, skillsDir = join(REPO_ROOT, ".claude/skills")) {
  if (typeof src !== "string" || !src.endsWith(".jsonl")) return null;
  let type;
  try { type = JSON.parse(readFileSync(src.slice(0, -".jsonl".length) + ".meta.json", "utf8")).agentType; } catch { return null; }
  if (typeof type !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(type)) return null;
  try { return readdirSync(join(skillsDir, type)).some((f) => /^MEMORY.*\.md$/.test(f)) ? type : null; } catch { return null; }
}
function classifyBlockEvidence(shingles, lensSet, memorySet, artifactSet) {
  if (!lensSet) return classifyShingleEvidence(shingles, memorySet, artifactSet);
  // ∩ memorySet: the lens diff alone cannot see a REMOVAL in another file, so text MOVED verbatim from a todo row
  // or another expert's shard into this expert's memory read as new. Lens credit is a subset of class credit.
  return classifyShingleEvidence(shingles, { has: (x) => lensSet.has(x) && memorySet.has(x) }, { has: (x) => memorySet.has(x) || artifactSet.has(x) });
}
// The runtime's lens wiring, at module scope so the self-test drives it (a review found that a one-token
// `const lens = null` at the old call site, or a pathspec that lost the shard glob, left all 129 arms green).
// One diff per expert, lazy and cached; a diff that cannot be read is an EMPTY set, which can only withhold.
function makeLensSetFor(anchor, cwd = REPO_ROOT) {
  const cache = new Map();
  return (lens) => {
    if (!lens) return null;
    if (!cache.has(lens)) {
      let set = new Set();
      try {
        set = addedEvidenceShingles(execSync(`git diff -U0 ${anchor}..HEAD -- '.claude/skills/${lens}/MEMORY*.md' 2>/dev/null`,
          { cwd, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }));
      } catch { /* empty set: withholds the credit */ }
      cache.set(lens, set);
    }
    return cache.get(lens);
  };
}
function classifyEmittedBlock(blk, memSet, artSet, lensSetFor, lensOf = lensOfSrc) {
  const shingles = blk ? bodyShingles(norm(blk.body)) : [];
  const lens = blk ? lensOf(blk.src) : null;
  return { shingles, lens, ev: classifyBlockEvidence(shingles, lensSetFor(lens), memSet, artSet) };
}

// ── DEEP-PASS DISPATCH SIGNAL (2026-08-25) ──────────────────────────────────────
// The filename regex below answers "was a deep pass spelled the way the spec spells it",
// not "did one happen". Measured 2026-08-07: 5 slices dispatched, all 5
// returned, findings folded — and the gate printed `ran=false`, because the slices were
// written by a python splitter instead of `sed -n 'A,Bp' > /tmp/wrap-dp-N.jsonl`. A
// false NEGATIVE costs a redundant re-dispatch, or teaches readers to ignore the line.
//
// ⛔ THE OBVIOUS FIX IS DELIBERATELY NOT TAKEN — adding the new slicer's name to the
// alternation is renaming-collisions-one-at-a-time, and it re-arms for the next slicer.
// The prescription was to key on an ARTIFACT instead, and it named two: the corpus-fence sentence
// in a dispatch prompt, or N task `.output` files. ⚠️ THE SECOND IS GONE: `~/.claude/
// tasks/*` holds only `.lock`/`.highwatermark`/`.json` today — zero `.output` files, and
// the newest dir is 11 days stale. So the artifact half of that prescription had rotted —
// FOR THAT ROOT. The LIVE `.output` files are under `/private/tmp/claude-*/<project-key>/`
// — the session's own `<sid>/tasks/` (`sidTasksDir` below) AND every other dir the transcript's
// `outputFile` values name (`tasksDirs`; deep-pass/SKILL.md's outputFile bullet); do not read this note as
// "no task outputs exist".
//
// WHAT MAKES THIS ONE SELF-MATCH-PROOF is not the string, it is WHERE the string is.
// The spec's own warning is that a shape-keyed detector matches the spec text once the
// skill is loaded into context — true of any regex over `raw`. But a loaded spec appears
// as assistant/user TEXT; it can never appear as the `input.prompt` of a real `tool_use`
// record, because only an actual dispatch creates one. Parsing structurally and reading
// only inside tool_use is therefore "something the spec cannot contain" in the sense the
// spec asked for. Threshold is ≥2 because a deep pass is a FAN-OUT; one agent is not one.
const deepPassDispatchCount = (jsonlLines) => {
  let n = 0;
  for (const l of jsonlLines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    const content = r && r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || c.type !== "tool_use" || c.name !== "Agent") continue;
      const p = c.input && typeof c.input.prompt === "string" ? c.input.prompt : "";
      // A dispatch whose prompt POINTS AT a brief file carries no `.jsonl` of its own, so the
      // first arm alone read 0 for an 11-slice wave whose briefs lived in `brief-NN.txt`
      // (2026-09-29). The dispatch's own `description` sits in the same tool_use
      // input, which spec prose can never reach, so it keeps the self-match proof above.
      const d = c.input && typeof c.input.description === "string" ? c.input.description : "";
      if ((/\.jsonl\b/.test(p) && /slice|deep[- ]?pass|offset/i.test(p))
        || (/deep[- ]?pass/i.test(d) && /slice/i.test(p))) n++;
    }
  }
  return n;
};

// ── MODULE-SCOPE PROBE PRIMITIVES (2026-07-13) ────────────────────────────
// These MUST live at module scope so the SELF-TEST CONSUMES THE REAL SYMBOLS. The first
// cut defined them inside the runtime block and had the self-test assert on private
// REPLICAS (`_probe`, a copied `driftKinds`) — which made every probe assertion
// STRUCTURALLY INCAPABLE OF FAILING under a runtime mutation (revert the real regex to the
// broken `!/DRIFT/i` and the suite still read ALL PASS). The comment even said "mirrors the
// runtime helper exactly," documenting the defect as a feature. That is the replica defect
// itself, in the guard built to prevent it. Reference shape: `check-lesson-numbers.mjs` exports its real
// `scan()` and its self-test imports it.

// Drift-section detector for the Step-7d probe. ANCHORED on the emitter's counted-section
// headers ("LISTING DRIFTS (2)", "APPENDIX C COVERAGE (1)") — NEVER the bare word: the first
// cut used `!/DRIFT/i` and fired on architecture-counts' own CLEAN line, which reads
// "no drift, no listing gaps" (an unanchored substring, defeated by its own success message).
const driftKinds = (s) => s.match(/[A-Z][A-Z +]*(?:DRIFTS?|COVERAGE)\s*\(\d+\)/g) || [];

// ── BLOCK-CLASSIFIER PRIMITIVES (module scope so the SELF-TEST CONSUMES THE REAL CODE) ──
// These were previously DUPLICATED: the runtime had one copy and the self-test asserted on a
// private replica. MEASURED 2026-07-13: the file held TWO copies of the None-regex, and
// neutering the RUNTIME one left the self-test reporting ALL PASS — the classifier assertions
// were structurally incapable of failing. This was flagged in an earlier review;
// the probe helpers were hoisted then and the classifier was left behind. One definition now.
// ⛔ TWO hashes, not three. The agent contract says `### Memory Update`, but a two-hash block is
// what several agents actually emit, and the old `/###\s*Memory Update/` read it as ABSENT — a
// FALSE GREEN on the one net that catches a dropped memory block. Measured against the live
// regex: "### …" true, "#### …" true, "## …" FALSE.
//
// ⛔ AND IT CANNOT BE LINE-ANCHORED WITH `^`+`m`. This scans the RAW JSONL, where a newline is a
// literal BACKSLASH + n (the `deescape` helper below exists for exactly that reason and runs
// AFTER this match), so `^` in multiline mode has almost no real line starts to bind to. The
// lookbehind therefore admits all three shapes a block can follow: string start, a REAL newline,
// or the escaped `\n` that the live input actually carries.
//
// Side effect, deliberate and verified: this also TIGHTENS a pre-existing over-match. A mid-line
// prose mention ("see the ### Memory Update convention") matched under the old regex and does not
// under this one, because a real block is always preceded by a line boundary in one of the three
// forms above.
//
// The leading `[ \t]*` admits an INDENTED block. The first version of this tightening had no
// such class and read an indented `### Memory Update` as ABSENT — a coverage regression the
// old unanchored regex did not have. Indentation is IN scope: an agent
// emitting the block inside a nested list still emitted it. Mid-line prose stays excluded,
// because a mention has NON-whitespace before the hashes.
const lastMarkerIdx = (text) => {
  const re = /(?<=^|\n|\\n)[ \t]*#{2,}\s*Memory Update/gi; let m, i = -1;
  while ((m = re.exec(text)) !== null) i = m.index;
  return i;
};
// DE-ESCAPE before any word-boundary test: the .output is JSONL, so `\n` is a literal
// BACKSLASH + n, which glues the escape's `n` onto `None` and kills `\bNone\b`.
const deescape = (text) => text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
const isNoneSkip = (block) => /\bNone\b[\s\S]{0,14}?\b(no|nothing)\b/i.test(block.slice(0, 260));
const hasDatedHeader = (block) => /##\s*(20\d\d-\d\d-\d\d|L\d{2,})/.test(block);
const classifyBlock = (text) => {
  const at = lastMarkerIdx(text);
  if (at < 0) return "no-block";
  const b = deescape(text.slice(at));
  if (isNoneSkip(b)) return "none";
  return hasDatedHeader(b) ? "emitted" : "unclassified";
};
const blockHeaderOf = (text) => {
  const at = lastMarkerIdx(text);
  if (at < 0) return null;
  const m = deescape(text.slice(at)).match(/##\s*(20\d\d-\d\d-\d\d[^"]{0,60}|L\d{2,}[^"]{0,60})/);
  return m ? m[1] : null;
};

// Probe factory. A probe that CANNOT RUN pushes to `blindArr` and returns null — it must never
// silently pass — a green check must never mean "the check didn't run".
// `smoke` exists for smoke FIXTURES only (scripts/lib/wrap-reconcile-smoke-skip.mjs fills `skip`, and only
// for a `zzsmoke-` session id): a probe whose STEP ID — the label's first word, e.g. `step-7h` — is in
// `smoke.skip` does not run. It records a SKIPPED line in blindArr for humans (so the verdict is BLIND,
// never CLEAN) and its id in `smoke.skipped` for machines, and every step id is counted in `smoke.seen`
// so smokeSkipProblems can make a stale or doubly-matched skip id loud. The branch lives HERE, in the
// factory the self-test consumes, not in a runtime replica.
const makeProbe = (blindArr, smoke = { skip: new Set(), skipped: [], seen: new Map(), sid: "" }) => (label, fn) => {
  const stepId = label.split(" ")[0];
  smoke.seen.set(stepId, (smoke.seen.get(stepId) || 0) + 1);
  if (smoke.skip.has(stepId)) {
    smoke.skipped.push(stepId);
    blindArr.push(`${label} probe SKIPPED for smoke fixture ${smoke.sid} (WRAP_RECONCILE_SMOKE_SKIP)`);
    return null;
  }
  try { return fn(); } catch (e) { blindArr.push(`${label} probe failed: ${String((e && e.message) || e).slice(0, 90)}`); return null; }
};

// A skip id that matched NO probe (a typo, or the probe was renamed) or MORE THAN ONE (two probes now
// share a step id) must be loud — without this both are silent no-ops. Module scope for the self-test.
// ⚠️ `seen` counts CALLS, not call sites, so `n > 1` means "a collision" only while each step id's probe runs
// once per invocation (true 2026-09-14: 5 probe() call sites, one per id). A probe moved into a loop would
// read as a collision the moment its id is skipped — give each iteration its own id, or count sites.
const smokeSkipProblems = (skip, seen) => [...skip].flatMap((id) => {
  const n = seen.get(id) || 0;
  if (n === 0) return [`WRAP_RECONCILE_SMOKE_SKIP names "${id}", which matched no probe (a typo, or the probe was renamed)`];
  if (n > 1) return [`WRAP_RECONCILE_SMOKE_SKIP "${id}" matched ${n} probes — a skip id must name exactly one check`];
  return [];
});

// FILENAME/RANGE arm of `deepPassRan`. Module scope so the SELF-TEST CONSUMES THE REAL SYMBOL.
// ⛔ BOTH TERMS MUST BE ANCHORED TO AN ARTIFACT, NEVER TO A NAME — that asymmetry WAS the bug.
// The range term always required a `.jsonl` within 160 chars, so prose could not satisfy it.
// The filename term required only a bare token, so prose satisfied it trivially: the spec
// MANDATES announcing a plan line whose token begins `wrap-dp-` + a letter, and `\w` took the
// letter. That announcement appears in the spec itself, which loads into the transcript this
// regex tests, so the term was true on every wrap and `if (deepPassFired && !deepPassRan)`
// could never fire. Measured 2026-09-04 with a negative control.
// ⛔ THE FIRST FIX WAS AN EXCLUSION AND IT LASTED ONE HOUR. A `(?!plan)` lookahead cleared the
// spec's literal and was then satisfied by the fix's OWN explanatory comment — that is
// the argument for anchoring instead: an exclusion list handles carriers one at a time and the
// next sentence anyone writes can re-arm it. Requiring DIGITS THEN `.jsonl` closed the FILENAME
// term against prose. ⛔ IT DID NOT CLOSE THE RANGE TERM, AND THIS COMMENT SAID "PROSE-RESISTANT BY
// CONSTRUCTION" OF THE WHOLE REGEX UNTIL 2026-09-29: a plain chat
// sentence "to cut the corpus run sed -n '10,20p' notes.jsonl" matches it, and so does the self-test's
// own `_dpSpecProse`. Tested over the RAW transcript, a session that merely READS this file or talks
// about the command reads ran=true — measured twice: one session hid a real SKIPPED that way, and the
// live proof for the fix flipped at the tool_result of a `sed` over this block. No regex over text
// can separate a command from a sentence ABOUT the command; WHERE the string sits can. So the regex is
// only ever tested inside a real tool_use input — `deepPassArtifactInToolUse` below — the same move
// that makes `deepPassDispatchCount` self-match-proof.
// NOT exported: the self-test reads this const directly from inside this file, so an export
// buys nothing and advertises an import path that is NOT safe — there is no main-guard here
// and the reconcile does real work at module scope, so importing this symbol would run the
// whole script as a side effect.
const DEEP_PASS_ARTIFACT_RE =
  /wrap-dp-\d+\.jsonl|sed -n ['"]?\d+,\d+p['"]?[^]{0,160}\.jsonl/;
// The artifact regex, tested ONLY inside a tool_use's `input.command` (a Bash slice) or
// `input.prompt` (an Agent brief). Loaded spec text, chat prose and tool_RESULT echoes are
// text blocks or tool_result blocks, never tool_use input, so none of them can satisfy it.
// Prefilter on `includes("jsonl")`, NOT on the regex: JSON writes `"` as `\"`, so a raw-line
// regex test would miss a double-quoted `sed -n "1,500p"` that the parsed string carries.
// Cost measured over 291 transcripts: `ran` changes in exactly one session,
// true → false, and that one was a real missed deep pass.
const deepPassArtifactInToolUse = (jsonlLines) => jsonlLines.some((l) => {
  if (!l.includes("jsonl")) return false;
  let r;
  try { r = JSON.parse(l); } catch { return false; }
  const content = r && r.message && r.message.content;
  return Array.isArray(content) && content.some((c) => c && c.type === "tool_use" && c.input
    && [c.input.command, c.input.prompt].some((s) => typeof s === "string" && DEEP_PASS_ARTIFACT_RE.test(s)));
});

// DEEP-PASS CORPUS STRIP — module scope, so the runtime gate below AND the self-test consume the
// SAME function (the replica warning at the STAGE-1 CORPUS block: two copies existed and breaking
// the runtime one left the suite ALL PASS). This was computed INLINE in the runtime block until
// 2026-09-15, so zero self-test arms could see it.
// ⛔ THE HARNESS WRITES AN IMAGE PAYLOAD UNDER TWO KEYS — `source.data` and `toolUseResult.file.base64`
// — and a pattern naming only `data` kept 397,933,828 B across 250 transcripts, one post-blank line at
// 3,102,592 B (1.55x a whole 2 MB agent slice). A DELETE filter was key-agnostic by accident because it
// dropped the record; converting delete to BLANK turned that into a predicate that must enumerate the
// keys. An enumeration over the store closed it: `base64` is the only surviving key, the
// 200-char floor excludes no real payload (smallest 1,208 chars), key order is irrelevant.
const BASE64_PAYLOAD_RE = /"(data|base64)":"[^"]{200,}"/g;
function blankBase64Payloads(line) {
  return line.includes('"type":"base64"') ? line.replace(BASE64_PAYLOAD_RE, '"$1":"<stripped>"') : line;
}
function strippedTranscriptBytes(lineArr) {
  return Buffer.byteLength(lineArr.map(blankBase64Payloads).join("\n"), "utf8");
}
// A clock label typed from impression rather than read off a commit, mail or `date -u`: the
// rounded minute ("20:3xZ", "10:xxZ") and the approximate estimate ("~18:50Z", "≈14:05Z",
// a tilde range "~08:45-09:10Z"). No zone is required, so CEST / local / bare forms count too.
// No word boundary before the digits, so the form embedded in an ISO timestamp ("…T20:2xZ") is
// caught; the lookaheads stop a longer digit run ("~12:345") or a hex tail ("12:0x1f").
const ESTIMATED_CLOCK_RE = /[~≈]\d{1,2}:\d{2}(?!\d)|\d{2}:[\dx]x(?![A-Ya-z0-9])/g;
function estimatedClockLabels(text) {
  const hits = [];
  text.split("\n").forEach((l, i) => { const m = l.match(ESTIMATED_CLOCK_RE); if (m) hits.push({ line: i + 1, labels: m }); });
  return hits;
}
// An EXACT-looking stamp typed AHEAD of the clock: a dated plan line ("- 2026-10-03T03:50Z — …")
// whose time is later than the moment the line was written. The estimate regex above cannot see it
// (a bare HH:MMZ reads as a real reading), and it is the commoner shape: one seat typed four in a
// day, 5 to 16 minutes ahead, one of them while correcting the other three. `writtenMs[i]` is when
// line i was written: the EARLIEST of its blame committer-time (not author-time: an --amend keeps the original author date and would false-flag), the file's mtime (no line in the file
// was written after it; git stamps an uncommitted line with NOW, which mtime undercuts) and the
// transcript tool_use that typed it. 60 s of slack covers a stamp read off `date -u`. The transcript
// leg is the one that sees a stamp typed ahead and committed LATER (the 03:05Z typed at 02:59:45Z,
// committed 03:34Z); blame alone cannot. Forms: "- ", "#+ ", optional ** bold, optional :SS.
const DATED_LINE_RE = /^(?:- |#+ )\*{0,2}(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z/;
function futureStampedLines(lines, writtenMs) {
  const hits = [];
  lines.forEach((l, i) => {
    const m = l.match(DATED_LINE_RE);
    const w = writtenMs[i];
    if (!m || !Number.isFinite(w)) return;
    const stamp = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`);
    if (stamp - w > 60_000) hits.push({ line: i + 1, aheadMin: Math.round((stamp - w) / 60_000) });
  });
  return hits;
}
// `git blame --line-porcelain` -> one write time per content line, capped at capMs. --line-porcelain,
// NOT --porcelain: the latter prints committer-time only on a commit's FIRST group, so a later group
// inherits the previous commit's time (measured: a +60m false flag). `cur` resets after every line,
// so that shape yields NaN (the probe goes blind) instead of a borrowed time.
function blameWriteTimes(porcelain, capMs = Infinity) {
  const written = []; let cur = NaN;
  for (const bl of porcelain.split("\n")) {
    if (bl.startsWith("committer-time ")) cur = Math.min(Number(bl.slice(15)) * 1000, capMs);
    else if (bl.startsWith("\t")) { written.push(cur); cur = NaN; }
  }
  return written;
}
// Per plan line: the timestamp of the EARLIEST tool_use aimed at this plan (base in file_path or the
// command) whose written text carries the line's first 60 chars; NaN when none does (fall back to blame).
function transcriptWriteTimes(txLines, base, planLines) {
  const writes = [];
  for (const l of txLines) {
    if (!l.includes(base)) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    const c = r?.message?.content;
    if (r?.type !== "assistant" || !Array.isArray(c)) continue;
    for (const b of c) {
      const i = b?.type === "tool_use" ? b.input : null;
      if (!i || !`${i.file_path ?? ""} ${i.command ?? ""}`.includes(base)) continue;
      const text = [i.new_string, i.content, i.command, ...(i.edits ?? []).map((e) => e?.new_string)].filter((s) => typeof s === "string").join("\n");
      writes.push({ ms: Date.parse(r.timestamp), text });
    }
  }
  return planLines.map((l) => { const hit = DATED_LINE_RE.test(l) && writes.find((w) => w.text.includes(l.slice(0, 60))); return hit ? hit.ms : NaN; });
}

// The (d)/(e) remedy is a FUNCTION DECLARATION so the self-test can read it and no temporal dead zone
// can reach it (the first version named a bare `tasks/*.output`, a zsh `nomatch`
// abort from the repo root; its arm was handed `() => …` until a later fix). It names the dirs THIS run
// counted and drives `find`: the project-wide `*/tasks/*.output` glob an earlier version wrote expanded to
// 14,562 files / 1.72 MB against ARG_MAX 1,048,576 (measured 2026-10-05 UTC) and died `argument list too
// long` — a clean 0 under `2>/dev/null`, against 146 real hits for the same token via `find`.
function residualDeRemedy(dirs, pattern = "*.output") {
  const where = dirs.length ? dirs.map((d) => JSON.stringify(d)).join(" ") : "<no tasks dir was read>";
  return `\`find ${where} -name '${pattern}' -exec grep -lF '<title>' {} +\` — the dirs THIS run counted (the session's own durable subagents store when it exists; else its own uuid tasks dir plus every dir this transcript's \`outputFile\` values name); NOT a project-wide glob over every session's tasks dir, which overflows ARG_MAX; NOT \`~/.claude/tasks\`, which holds no \`.output\` files; NOT a bare \`tasks/\` from the repo root, which zsh \`nomatch\`-aborts — and read whether the hit sits in a RESULT or in the prompt/summary that quotes it.`;
}

// ⛔ 2026-10-05: a session's task files are NOT all under `<sid>/tasks`. From 20:03Z that
// day one session's newest 41 (all 12 deep-pass slice reports among them) sat in a second uuid
// dir, so a read of the first dir alone made the emit count a floor. An Agent result's
// `"outputFile":"…"` names each real file, so the dirs come from the transcript.
// ⛔ STRUCTURAL KEYS ONLY. A bare-quoted `"outputFile":"` exists only as a JSON
// key: a transcript, mail or report quoted inside a tool result is JSON-escaped and cannot match. A
// task notification's `<output-file>` tag is NOT escaped, so a QUOTED one matched: on one session
// a Bash dump of another session's transcript added that session's dir — 53 emitted vs 8, 44
// accused vs 3. Across 308 transcripts the tag never named an agent file the keys missed: of the 3
// dirs only notifications named, the 2 that still exist held no agent transcript a key did not also
// name. The same was measured on two transcripts (120/120 and 829/829), and a
// quoted tag took a fixture from 1 to 401 emitted. `exists` is injectable.
function taskDirsFromTranscript(text, exists = existsSync) {
  const dirs = new Set();
  const re = /"outputFile":"(\/private\/tmp\/claude-[^"<\\\s]+?\/tasks)\/[^"<\\\s/]+\.output/g;
  for (const m of String(text || "").matchAll(re)) if (exists(m[1])) dirs.add(m[1]);
  return [...dirs];
}
// The session's own dir first, then every dir the transcript names — one list, deduped.
function collectTaskDirs(sidDir, text, exists = existsSync) {
  return [...new Set([...(sidDir ? [sidDir] : []), ...taskDirsFromTranscript(text, exists)])];
}
// THE DURABLE STORE (2026-10-06):
// every agent `.output` in every tasks dir is a SYMLINK into the session's own durable store,
// `~/.claude/projects/<project>/<sid>/subagents/agent-<id>.jsonl` — 120 of 120 on one session across
// both of its tmp dirs, 829 of 829 on the review seat's transcript. Reading the store proves
// ownership by path, no quoted line can add to it, and /tmp cleanup cannot shrink it — the gap where
// a named tmp dir was gone and the run printed ✅ over part of the population. The tmp dirs stay the
// FALLBACK for a transcript with no store beside it (a fixture, an older harness). Measured 2026-10-06
// in review: a sub-agent's own nested dispatch lands FLAT in this store, 179 of 179
// structural outputFile keys inside agent files; a Workflow run's agents land one level down, in
// `workflows/wf_<id>/` — 295 files in 6 sessions, 31 with a dated block, none ever counted by the tmp
// design. `fs` is injectable for the self-test.
// FALLBACK OWNERSHIP. A CONTINUED session (a transcript that opens on a
// compact_boundary under a NEW sid) copies its parent's records, and their structural "outputFile"
// keys name the PARENT's tmp dir, whose agent `.output` files link into the PARENT's store: 66 such
// links in 2 of the 4 continued sessions on disk at 2026-10-06. The store branch
// never reads them; the fallback does, for such a session before its own first dispatch, so it drops
// a link that resolves into another session's store. A plain file (a fixture) or a dangling link stays.
function agentReturnSource(transcriptPath, tmpDirs, fs = { exists: existsSync, list: readdirSync, real: realpathSync }) {
  const store = transcriptPath ? transcriptPath.replace(/\.jsonl$/, "/subagents") : null;
  if (store && store !== transcriptPath && fs.exists(store)) {
    const wf = `${store}/workflows`;
    const homes = [store, ...(fs.exists(wf) ? fs.list(wf).filter((n) => n.startsWith("wf_")).map((n) => `${wf}/${n}`) : [])];
    return { source: "store", dirs: [store], pattern: "agent-*.jsonl",
      files: homes.flatMap((d) => fs.list(d).filter((n) => /^agent-[0-9a-f]+\.jsonl$/.test(n)).map((n) => `${d}/${n}`)) };
  }
  const own = transcriptPath ? transcriptPath.split("/").pop().replace(/\.jsonl$/, "") : null;
  const real = fs.real ?? realpathSync;
  const foreign = (p) => {
    let r; try { r = real(p); } catch { return false; }
    const m = /\/([^/]+)\/subagents\/(?:workflows\/[^/]+\/)?agent-[0-9a-f]+\.jsonl$/.exec(r);
    return Boolean(m) && m[1] !== own;
  };
  return { source: "tmp", dirs: tmpDirs, pattern: "*.output",
    files: tmpDirs.flatMap((d) => fs.list(d).filter((n) => n.endsWith(".output")).map((n) => `${d}/${n}`)).filter((p) => !foreign(p)) };
}

// ── IRON LAW #6 LEG (2026-10-09) ──
// /wrap Steps 1 / 2 / 3 / 3a / 7a INVOKE `/hanging-work`, `/meta learn`, `/session-memory`, `/decisions` and
// `/me learn-session`, and Iron Law #6
// (`.claude/orchestrator/conventions.md` § #6) is a tool-call event, so the invocation log can check it.
// REPORT-ONLY: each sub-skill has its own skip gate (Step 2's trivial-session rule, Step 3's <15-min
// exception, /decisions' nothing-to-record skip), and a legitimate skip leaves the same absence as a
// narrated one — so a MISSING goes to notes[], never findings[], and never moves the verdict. Module
// scope: the runtime call and the self-test arms consume this one function.
const SKILL_LOG = ".claude/logs/skill-invocations.jsonl";
const WRAP_SUBSKILLS = [
  ["/hanging-work", (r) => r.skill === "hanging-work"],
  ["/meta learn", (r) => r.skill === "meta" && /^\s*learn(\s|$)/.test(r.args || "")],
  ["/session-memory", (r) => r.skill === "session-memory"],
  ["/decisions", (r) => r.skill === "decisions"],
  ["/me learn-session", (r) => r.skill === "me" && /^\s*learn-session(\s|$)/.test(r.args || "")],
];
// Checkpoint intent is DECLARED (wrap/SKILL.md § Checkpoint mode): the `--checkpoint` flag anywhere, or the
// bare alias `checkpoint` as the FIRST word. Prose args that merely mention the word are a full wrap.
const isCheckpointWrap = (a) => { const w = String(a ?? "").trim().split(/\s+/); return w.includes("--checkpoint") || w[0] === "checkpoint"; };
function wrapSubSkillGaps(logText, sessionId) {
  const recs = []; let unparsed = 0, heads = 0, mine = 0;
  for (const l of logText.split("\n")) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch { unparsed++; if (l.startsWith('{"ts":')) heads++; if (sessionId && l.includes(sessionId)) mine++; continue; }
    if (r && r.session === sessionId && Number.isFinite(Date.parse(r.ts))) recs.push(r);
  }
  const at = (r) => Date.parse(r.ts);
  const wraps = recs.filter((r) => r.skill === "wrap" && !isCheckpointWrap(r.args)).map(at);
  const since = wraps.length ? Math.max(...wraps) : null;
  const missing = since == null ? null
    : WRAP_SUBSKILLS.filter(([, is]) => !recs.some((r) => at(r) >= since && is(r))).map(([name]) => name);
  return { since: since == null ? null : new Date(since).toISOString(), missing, unparsed, heads, mine };
}

// ── SELF-TEST (deterministic; proves the content-match + norm) ──
if (args.includes("--self-test")) {
  let ok = true;
  // `cond === true`, not truthiness: an arm handed `() => …` passed for its whole life until it
  // was fixed, and a function, a non-empty string or a count is truthy. 0 of 116 arms passed a
  // non-boolean when this landed, so the strict form changes no verdict.
  const t = (name, cond) => { const pass = cond === true; if (!pass) ok = false; console.log(`${pass ? "PASS" : "FAIL"}  ${name}${typeof cond === "boolean" ? "" : `  (t() takes a boolean, got ${typeof cond})`}`); };
  // DEFERRAL: the branch that turns the post-compact finding into a note asks
  // the REAL script; these arms run it against a temp state dir, both ways, so a broken ask cannot
  // read green. Exit 0 = DEFERRED; anything else (no breadcrumb, a boundary landed, a crash) = OWED.
  {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const d = mkdtempSync(join(tmpdir(), "wr-defer-"));
    try {
      const tx = join(d, "t.jsonl"); writeFileSync(tx, "");
      writeFileSync(join(d, "post-compact-pending-wr-probe"), "compacted=2026-10-02 08:37:16 UTC trigger=auto focus=no focus_args=<none>\n");
      t("deferral: no breadcrumb yet → OWED (Step 1 has not looked)", deferralStatus("wr-probe", tx, d) === false);
      execSync(`python3 ${JSON.stringify(join(REPO_ROOT, "scripts/post-compact-deferral.py"))} decide --sid wr-probe --state-dir ${JSON.stringify(d)} --tx ${JSON.stringify(tx)}`, { stdio: "ignore" });
      t("deferral: Step 1 deferred, no boundary → DEFERRED", deferralStatus("wr-probe", tx, d) === true);
      writeFileSync(tx, JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: "2026-10-02T08:59:25.466Z" }) + "\n");
      t("deferral: a boundary lands → OWED again", deferralStatus("wr-probe", tx, d) === false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // (1) norm collapses the JSONL `—` em-dash so it matches the real `—` on disk.
  const emitSlice = norm("2026-07-03 \\u2014 sample lesson title").slice(0, 40);
  const onDisk = norm("## 2026-07-03 — sample lesson title for the matcher");
  t("norm: transcript \\u2014 em-dash matches on-disk —", emitSlice.length >= 8 && onDisk.includes(emitSlice));
  // (1c) the corpus is normalised in chunks; size 7 puts a boundary at every newline, and the punctuation-only
  // line becomes a chunk that normalises to nothing, which must not add a second space.
  const _nc = "## 2026-07-03 \\u2014 Sentinel\\n\n\n—— *** ——\nPEER — \"Cap\" lesson\\tX\nend\n".repeat(3);
  t("normChunked: chunked at newlines is identical to one norm() over the whole corpus", normChunked(_nc, 7) === norm(_nc) && normChunked("", 7) === norm(""));
  // (2) content-match discriminates persisted (present) from unpersisted (absent),
  //     and is IMMUNE to peer noise (unrelated headers in `mem` don't inflate it).
  const mem = norm("## 2026-07-03 — completeness sentinel\\n## 2026-07-03 — app cap\\n## 2026-07-03 — PEER unrelated lesson");
  const heads = [
    norm("2026-07-03 \\u2014 completeness sentinel").slice(0, 40), // persisted
    norm("2026-07-03 \\u2014 never persisted anywhere").slice(0, 40), // NOT persisted
  ];
  const found = heads.filter((h) => h.length >= 8 && mem.includes(h)).length;
  t("content-match: exactly 1 of 2 found (delta=1, peer headers ignored)", found === 1);

  // SLICE → SOURCE inverse. Both arms required, and the NEGATIVE one is the
  // point: a slice with no block must not silently render as some other block's file, which
  // would be a fabricated citation on the one gate that stops a wrap self-certifying.
  const _blocks = [{ headerSlice: "abc lesson one", body: "x", src: "a1b2c3.output" },
                   { headerSlice: "def lesson two", body: "y", src: "d4e5f6.output" }];
  t("slice→source: an accused slice resolves to the agent-return file it came from",
    srcFor(_blocks, "def lesson two") === "d4e5f6.output");
  t("slice→source: an unknown slice says so rather than borrowing a neighbour's file",
    srcFor(_blocks, "ghi never emitted") === "(source unknown)");
  t("slice→source: an EMPTY block list still degrades to the honest string, never a crash",
    srcFor([], "anything") === "(source unknown)");
  // (2a) DEEP-PASS ARTIFACT REGEX — the false-POSITIVE fix (2026-09-04). The spec's own
  //      mandated announcement must NOT satisfy it; a real slice artifact must.
  t("artifact-re: the spec's own mandated plan announcement does NOT match",
    !DEEP_PASS_ARTIFACT_RE.test("wrap-dp-" + "plan: 11 slices covering lines 1772-10984"));
  t("artifact-re: PROSE naming the token does NOT match (a fourth carrier)",
    !DEEP_PASS_ARTIFACT_RE.test("the old regex matched wrap-dp-p, so the term was always true"));
  t("artifact-re: the BRACKET placeholder does NOT match",
    !DEEP_PASS_ARTIFACT_RE.test("/tmp/wrap-dp-<i>.jsonl"));
  t("artifact-re: a real slice filename DOES match",
    DEEP_PASS_ARTIFACT_RE.test("/tmp/wrap-dp-03.jsonl"));
  t("artifact-re: a real single-digit slice filename DOES match",
    DEEP_PASS_ARTIFACT_RE.test("/tmp/wrap-dp-3.jsonl"));
  t("artifact-re: a real sed range dispatch DOES match",
    DEEP_PASS_ARTIFACT_RE.test("sed -n '100,200p' /tmp/x.jsonl"));
  t("artifact-re: plain prose does NOT match",
    !DEEP_PASS_ARTIFACT_RE.test("nothing to see here"));
  // (2b) DEEP-PASS DISPATCH SIGNAL — the false-NEGATIVE fix. Arms consume the REAL symbol.
  //      The load-bearing one is the SELF-MATCH arm: the spec's own prose describing a
  //      deep pass must NOT satisfy it, which is exactly what the filename regex cannot
  //      promise once the skill is loaded into context.
  const _dpDispatch = (prompt) => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Agent", input: { prompt } }] },
  });
  const _dpSpecProse = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text",
      text: "slice the deep-pass corpus with sed -n '1,500p' wrap-stripped-<sid>.jsonl" }] },
  });
  t("deep-pass: spec PROSE describing a slice does NOT count (self-match proof)",
    deepPassDispatchCount([_dpSpecProse]) === 0);
  t("deep-pass: a python-sliced fan-out of 5 counts 5 (the measured false negative)",
    deepPassDispatchCount(Array.from({ length: 5 }, (_, i) =>
      _dpDispatch(`read slice /tmp/dpslice-abc/s${i}.jsonl and report findings`))) === 5);
  t("deep-pass: ONE agent is not a fan-out (threshold is >=2)",
    deepPassDispatchCount([_dpDispatch("read slice /tmp/x/s0.jsonl")]) < 2);
  t("deep-pass: an unrelated Agent dispatch does NOT count",
    deepPassDispatchCount([_dpDispatch("refactor the pricing component")]) === 0);
  t("deep-pass: malformed JSONL is skipped, not thrown on",
    deepPassDispatchCount(["{not json", ""]) === 0);
  // The brief-file shape: the prompt names a `.txt` brief and no `.jsonl`; the description
  // names the deep pass. Measured false negative on an 11-slice wave (2026-09-29).
  const _dpDispatchD = (prompt, description) => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Agent", input: { prompt, description } }] },
  });
  t("deep-pass: a brief-FILE fan-out counts via the dispatch's own description",
    deepPassDispatchCount(Array.from({ length: 3 }, (_, i) =>
      _dpDispatchD(`You are deep-pass slice scanner 0${i}. Read your brief: /tmp/x/brief-0${i}.txt`,
        `Deep-pass slice 0${i}`))) === 3);
  t("deep-pass: a brief-file prompt with no deep-pass description does NOT count",
    deepPassDispatchCount([_dpDispatchD("Read your brief: /tmp/x/brief-00.txt and slice the work", "Refactor slice of the pricing page")]) === 0);
  // Pins the prompt's own `/slice/` test on the description arm (dropping it stayed green).
  t("deep-pass: a deep-pass DESCRIPTION whose prompt never says slice does NOT count",
    deepPassDispatchCount([_dpDispatchD("Review the pricing page copy", "Deep-pass follow-up")]) === 0);
  // Pins that the deep-pass test reads the DESCRIPTION only (testing it over
  // description+prompt stayed green). A lens brief ABOUT this detector names both words in its prompt.
  t("deep-pass: a PROMPT naming the deep-pass slice logic under a non-deep-pass description does NOT count",
    deepPassDispatchCount([_dpDispatchD("Review the deep-pass slice detector in scripts/wrap-reconcile.mjs", "Review wrap-reconcile")]) === 0);
  // (2c) ARTIFACT ARM, TESTED ONLY INSIDE tool_use. The first arm is the
  //      discriminator: the same text satisfies the bare regex and must NOT satisfy the real arm.
  const _dpBash = (command) => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
  });
  t("artifact-in-tool-use: spec PROSE matches the bare regex but NOT the tool_use arm",
    DEEP_PASS_ARTIFACT_RE.test(JSON.parse(_dpSpecProse).message.content[0].text)
      && !deepPassArtifactInToolUse([_dpSpecProse]));
  t("artifact-in-tool-use: a real Bash slice command counts (single-quoted range)",
    deepPassArtifactInToolUse([_dpBash("sed -n '1,500p' /tmp/wrap-stripped-abc.jsonl > /tmp/s00.txt")]));
  t("artifact-in-tool-use: a real Bash slice command counts (double-quoted range, JSON-escaped on disk)",
    deepPassArtifactInToolUse([_dpBash('sed -n "1,500p" /tmp/wrap-stripped-abc.jsonl > /tmp/s00.txt')]));
  t("artifact-in-tool-use: a tool_RESULT echoing the command does NOT count",
    !deepPassArtifactInToolUse([JSON.stringify({ type: "user", message: { content: [{ type: "tool_result",
      tool_use_id: "x", content: "ran: sed -n '1,500p' /tmp/wrap-stripped-abc.jsonl" }] } })]));
  t("artifact-in-tool-use: malformed JSONL is skipped, not thrown on",
    !deepPassArtifactInToolUse(["{not json jsonl", ""]));
  // (2b) DEEP-PASS CORPUS STRIP (REAL blankBase64Payloads / strippedTranscriptBytes). Each arm is
  //      keyed to a form that shipped or nearly shipped: the line-DELETING `grep -v` (removed an owner
  //      message sent with a screenshot), the `data`-only pattern (kept every `toolUseResult` copy),
  //      and a RAW-string Python replacement (writes literal backslashes into the JSON).
  const _pay = "A".repeat(1208);
  const _ownerShot = `{"type":"user","message":{"content":[{"type":"image","source":{"type":"base64","data":"${_pay}"}},{"type":"text","text":"leave it filed"}]}}`;
  const _toolShot = `{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"image","source":{"type":"base64","data":"${_pay}"}}]}]},"toolUseResult":{"type":"image","file":{"base64":"${_pay}","type":"image/png"}}}`;
  t("strip: an owner message sent with a screenshot KEEPS its text (the delete form dropped the record)",
    blankBase64Payloads(_ownerShot).includes('"text":"leave it filed"'));
  t("strip: BOTH payload keys are blanked, measured as residual BYTES not substitution count",
    !blankBase64Payloads(_toolShot).includes(_pay) && Buffer.byteLength(blankBase64Payloads(_toolShot)) < 400);
  t("strip: the blanked record is still valid JSON",
    (() => { try { JSON.parse(blankBase64Payloads(_toolShot)); return true; } catch { return false; } })());
  t("strip: a line with no base64 marker is untouched, even with a long data field",
    blankBase64Payloads(`{"data":"${_pay}"}`) === `{"data":"${_pay}"}`);
  t("strip: the fire gate reads stripped bytes, so 3,000 image-heavy records of tiny text stay under 3 MB",
    strippedTranscriptBytes(Array.from({ length: 3000 }, () => _toolShot)) < 3_000_000);
  // (2c) DURABLE-HOME SET (REAL DURABLE_HOMES). The always-loaded specs are the whole point:
  //      omitting AGENTS.md once produced a 6/6 FALSE ACCUSATION, and the fix that widened
  //      the set shipped with no arm, so it could regress in silence.
  for (const _home of ["AGENTS.md", "CLAUDE.md", "'.claude/skills/*/SKILL.md'",
                       "'.claude/skills/*/references/*.md'",
                       ".claude/meta-corrections-registry.md", "'messages/*.json'"]) {
    t(`durable-home set (REAL) still includes ${_home}`, DURABLE_HOMES.includes(_home));
  }
  t("durable-home pathspec is space-joined and non-empty (consumed by the real git diff)",
    DURABLE_HOME_PATHSPEC.split(" ").length === DURABLE_HOMES.length && DURABLE_HOME_PATHSPEC.length > 40);
  // (3) BLOCK CLASSIFIER (2026-07-10). Four branches, each a real
  //     bug that shipped: a JSON-escaped `\\nNone` defeating `\\bNone\\b`; a prose `## `
  //     heading above the marker being read as the block header; a first-match slice on a
  //     QUOTED marker; and an undated block being silently dropped instead of reported.
  // Consume the REAL module-scope classifier — NOT a replica. Mutation-proof: neuter the
  // runtime regex and these rows go RED. (Before 2026-07-13 they did not: two copies existed
  // and breaking the runtime one left the suite ALL PASS.)
  const classify = classifyBlock;
  t("classifier: JSON-escaped \\nNone is a None-skip (\\bNone\\b never matched pre-fix)",
    classify('### Memory Update\\nNone \u2014 no significant decisions; clean pass.') === "none");
  // The two-hash gap this matcher was blind to, plus the shapes that must keep working and the
  // mention that must NOT count. Consumes the REAL classifier, so neutering the runtime regex
  // reddens these.
  t("classifier: a TWO-hash Memory Update block is SEEN (was a false green)",
    classify('## Memory Update\\n## 2026-08-27 — real lesson') === "emitted");
  t("classifier: a two-hash block after an ESCAPED newline is seen (the live JSONL shape)",
    classify('prose\\n## Memory Update\\n## 2026-08-27 — real lesson') === "emitted");
  t("classifier: a MID-LINE mention of the marker is not a block",
    classify('see the ### Memory Update convention for details') === "no-block");
  // The INDENT pair. Deleting `[ \t]*` from the runtime regex reddens the first of these and
  // leaves the second GREEN — which is the point: the class must be admitted WITHOUT re-opening
  // the mid-line over-match the tightening closed.
  t("classifier: an INDENTED block is SEEN (was a false green)",
    classify('prose\\n  ### Memory Update\\n## 2026-08-27 \u2014 real lesson') === "emitted");
  t("classifier: indentation does NOT re-admit a mid-line mention",
    classify('  see the ### Memory Update convention here') === "no-block");
  t("classifier: prose `## ` ABOVE the marker is not the block header",
    classify('prose\\n## note\\n### Memory Update\\n## 2026-07-09 \u2014 real lesson') === "emitted");
  // A quoted marker only CHANGES the answer when a prose heading sits BETWEEN the quote and
  // the real block \u2014 otherwise first- and last-match extract the same header and the
  // assertion cannot fail (verified: the naive fixture stayed GREEN under a first-match
  // mutation). Assert on the EXTRACTED HEADER, not the classification.
  const headerOf = blockHeaderOf;   // REAL symbol, not a copy
  t("classifier: a QUOTED early marker does not steal the slice (last-match wins)",
    headerOf('### Memory Update (restating instructions)\\n## 2026-07-08 prose heading\\n### Memory Update\\n## 2026-07-09 \u2014 real') === "2026-07-09 \u2014 real");
  t("classifier: undated real-looking block is UNCLASSIFIED, never silently dropped",
    classify('### Memory Update\\nundated body, no heading') === "unclassified");
  // ⛔ EXPECTATION SHARPENED 2026-08-27, and the reason matters more than the value. This arm's
  // load-bearing property is in its own name — a prose MENTION must never count as EMITTED — and
  // both the old answer ("unclassified") and the new one ("no-block") satisfy it. The new answer
  // is strictly more correct: a mid-line mention is not a block at all, whereas "unclassified"
  // meant the reconcile surfaced it as a real block awaiting attention, i.e. a false positive.
  // The line-boundary lookbehind in `lastMarkerIdx` is what closed that; assert BOTH so a future
  // widening that re-admits mid-line text reddens here rather than passing quietly.
  t("classifier: prose-only mention of the marker is NOT emitted",
    classify('the spec says `### Memory Update` is required') !== "emitted");
  t("classifier: prose-only mention is not a block at all (mid-line mentions no longer count)",
    classify('the spec says `### Memory Update` is required') === "no-block");
  // (4) STEP-ARTIFACT PROBE contract. The whole point of a probe is that it CANNOT
  //     silently pass. A probe whose body throws (script missing, python absent, EISDIR) must
  //     land in blind[] — never return a green. Mutation-check: make `probe` swallow the throw
  //     and return true, and this assertion goes RED. Mirrors the runtime helper exactly.
  // (4)+(5) consume the REAL module-scope `makeProbe` / `driftKinds` — NOT replicas. A replica
  //         assertion cannot fail under a runtime mutation, which is the exact defect these
  //         guards exist to prevent (the replica version was proved green-under-mutation).
  const _blind = [];
  const _probe = makeProbe(_blind);              // the REAL factory, bound to a test array
  const okRet = _probe("healthy", () => "artifact-present");
  const blindAfterHealthy = _blind.length;      // capture BEFORE the throwing probe dirties it
  const badRet = _probe("throwing", () => { throw new Error("script missing"); });
  t("probe (REAL makeProbe): a healthy probe returns its value and adds no blind entry",
    okRet === "artifact-present" && blindAfterHealthy === 0);
  t("probe (REAL makeProbe): a THROWING probe returns null and registers BLIND (never a silent pass)",
    badRet === null && _blind.length === 1 && /throwing probe failed: script missing/.test(_blind[0]));
  // (4b) the SMOKE SKIP, on the REAL factory: a skipped step does not run, returns null, and lands in BOTH
  //      blind[] (prose) and skipped[] (ids); a step outside the list still runs; stale and doubly-matched
  //      skip ids are reported. Mutation-check: drop the blind push, the skipped push, or the skip test.
  const _sBlind = [];
  const _smoke = { skip: new Set(["step-7h"]), skipped: [], seen: new Map(), sid: "zzsmoke-selftest" };
  const _sProbe = makeProbe(_sBlind, _smoke);
  let _skippedFnRan = false;
  const skipRet = _sProbe("step-7h defer-triggers", () => { _skippedFnRan = true; return "ran"; });
  const runRet = _sProbe("step-7d architecture-counts", () => "ran");
  t("probe (REAL makeProbe): a smoke-skipped step does NOT run and is recorded in blind[] AND skipped[]",
    skipRet === null && !_skippedFnRan && _smoke.skipped.join() === "step-7h" && _sBlind.length === 1
    && /^step-7h defer-triggers probe SKIPPED for smoke fixture zzsmoke-selftest /.test(_sBlind[0]));
  t("probe (REAL makeProbe): a step outside the skip list still runs under the same factory", runRet === "ran");
  t("smokeSkipProblems (REAL): a stale skip id and a doubly-matched one are each reported; a clean list is silent",
    smokeSkipProblems(new Set(["step-9z"]), _smoke.seen).length === 1
    && smokeSkipProblems(new Set(["step-7h"]), new Map([["step-7h", 2]])).length === 1
    && smokeSkipProblems(new Set(["step-7h"]), _smoke.seen).length === 0);
  t("7d-detector (REAL driftKinds): the CLEAN line does not read as drift (unanchored-substring regression)",
    driftKinds("✅ architecture.md + COMPARISON banner clean — no drift, no listing gaps, Appendix C coverage exact").length === 0);
  t("7d-detector (REAL driftKinds): a real drift section IS detected (counted-section shape)",
    driftKinds("COUNT + NARRATIVE DRIFTS (22):\n  Line 499: hooks — claimed 35, actual 36\nAPPENDIX C COVERAGE (1):").length === 2);
  // (6) CRASH-LAUNDERING (measured): `cmd 2>&1 || true` turns a crashed script into
  //     non-empty PROSE (a node stack), which defeats an empty-output guard and reads as CLEAN.
  //     A drift-detector run over a stack trace must yield zero sections → the caller MUST treat
  //     "exit≠0 with no parsed section" as BLIND, never as clean. This asserts the discriminator.
  t("7d-detector: a node CRASH STACK parses as ZERO drift sections (so exit≠0 + 0 sections ⇒ BLIND, not clean)",
    driftKinds("node:internal/modules/cjs/loader:1143\n  throw err;\nError: Cannot find module '/x/architecture-counts.mjs'\n    at Module._resolveFilename").length === 0);
  // (7) Hub-relay shingle discriminator (REAL bodyShingles). A delegator's REWORDED
  //     persist shares surviving 4-word runs with the emitted body; a disjoint control shares
  //     none. Both directions asserted — "matches everything" would pass a one-sided check.
  const _emitBody = norm("the reconciler assumes the orchestrator that dispatched an agent is the one that persists its memory update which is false by construction for a review hub whose entire product is relayed to a delegator session");
  const _rewritten = norm("codified from the hub relay: the reconciler assumes the orchestrator that dispatched an agent also owns the persist — false by construction for a review hub, whose product lands in the delegator's commits.");
  const _control = norm("completely unrelated prose about pricing tier casing rules and locale drift sentinels with zero overlap in any four word run whatsoever across this entire sentence");
  const _sh = bodyShingles(_emitBody);
  const _hitsTP = _sh.filter((s) => _rewritten.includes(s)).length;
  const _hitsCtl = _sh.filter((s) => _control.includes(s)).length;
  {
    const _dA = "/private/tmp/claude-501/p/aaa/tasks", _dD = "/private/tmp/claude-501/p/ddd/tasks";
    const _rem = residualDeRemedy([_dA, _dD]);
    const _cmd = (_rem.match(/^`find ([^`]*)`/) || [])[1] || "";
    t("(d)/(e) remedy: a find over EVERY dir this run counted — no directory-level wildcard (ARG_MAX), never a bare tasks/*.output",
      _cmd.includes(JSON.stringify(_dA)) && _cmd.includes(JSON.stringify(_dD)) && _cmd.includes("-exec grep -lF") && !_cmd.includes("/*/") && !/(^|[\s(])tasks\/\*\.output/.test(_rem));
    const _fx = [
      `{"outputFile":"${_dA}/x1.output"}`, `"outputFile":"${_dA}/x3.output"`, `"outputFile":"${_dD}/x7.output"`,
      `"outputFile":"/private/tmp/claude-501/p/gone/tasks/x4.output"`,
      `<output-file>/private/tmp/claude-501/p/bbb/tasks/x2.output</output-file>`,
      `\\"outputFile\\":\\"/private/tmp/claude-501/p/ccc/tasks/x5.output\\"`,
      `"outputFile":"<home>/.claude/tasks/x6.output"`,
    ].join(" ");
    const _ex = (d) => !d.includes("/gone/");
    t("task dirs come from STRUCTURAL outputFile keys only — two dirs, deduped, the missing one dropped; a quoted <output-file>, an escaped outputFile and a non-tmp path ignored",
      JSON.stringify(taskDirsFromTranscript(_fx, _ex)) === JSON.stringify([_dA, _dD]));
    t("task dirs control: a transcript naming no task file yields no dirs", taskDirsFromTranscript("no paths here", () => true).length === 0);
    t("task dirs union: the session's own dir first, every named dir once — with, without, and equal to a named dir",
      JSON.stringify(collectTaskDirs("/s/tasks", _fx, _ex)) === JSON.stringify(["/s/tasks", _dA, _dD])
      && JSON.stringify(collectTaskDirs(null, _fx, _ex)) === JSON.stringify([_dA, _dD])
      && JSON.stringify(collectTaskDirs(_dD, _fx, _ex)) === JSON.stringify([_dD, _dA]));
    // The durable store beside the transcript wins; the tmp dirs are only the fallback.
    const _tx = "/h/proj/s1.jsonl", _st = "/h/proj/s1/subagents";
    const _ls = { [_st]: ["agent-a1f.jsonl", "agent-a1f.meta.json", "notes.txt"], [_dA]: ["a2.output", "b.txt"], [_dD]: ["a3.output"] };
    const _fsWith = { exists: (d) => d === _st, list: (d) => _ls[d] || [] };
    const _fsWithout = { exists: () => false, list: (d) => _ls[d] || [] };
    const _s = agentReturnSource(_tx, [_dA, _dD], _fsWith);
    const _f = agentReturnSource(_tx, [_dA, _dD], _fsWithout);
    t("agent-return source: a subagents store beside the transcript is the source — its agent-*.jsonl files only, and the remedy searches it",
      _s.source === "store" && JSON.stringify(_s.files) === JSON.stringify([`${_st}/agent-a1f.jsonl`])
      && JSON.stringify(_s.dirs) === JSON.stringify([_st]) && residualDeRemedy(_s.dirs, _s.pattern).includes(`${JSON.stringify(_st)} -name 'agent-*.jsonl'`));
    const _wf = `${_st}/workflows`, _ls2 = { ..._ls, [_wf]: ["wf_9c-1", "notes.md"], [`${_wf}/wf_9c-1`]: ["agent-b2c.jsonl", "journal.jsonl"] };
    const _w = agentReturnSource(_tx, [], { exists: (d) => d === _st || d === _wf, list: (d) => _ls2[d] || [] });
    t("workflow store: a Workflow run's agents under workflows/wf_*/ are part of the store; its journal is not",
      JSON.stringify(_w.files) === JSON.stringify([`${_st}/agent-a1f.jsonl`, `${_wf}/wf_9c-1/agent-b2c.jsonl`]));
    t("agent-return fallback: no store ⇒ every .output in every tmp dir, and a transcript path without .jsonl never maps to a store",
      _f.source === "tmp" && JSON.stringify(_f.files) === JSON.stringify([`${_dA}/a2.output`, `${_dD}/a3.output`])
      && agentReturnSource("/h/proj/s1", [_dA], { exists: () => true, list: (d) => _ls[d] || [] }).source === "tmp");
    // The fallback keeps only links into THIS session's store (a continued session's copied keys name its parent's dir).
    const _rl = { [`${_dA}/a2.output`]: "/h/proj/s0/subagents/agent-a2.jsonl", [`${_dD}/a3.output`]: "/h/proj/s1/subagents/agent-a3.jsonl" };
    const _fsLinks = { exists: () => false, list: (d) => _ls[d] || [], real: (p) => { if (p in _rl) return _rl[p]; throw new Error("ENOENT"); } };
    t("agent-return fallback drops a link into ANOTHER session's store and keeps its own; a plain file stays",
      JSON.stringify(agentReturnSource(_tx, [_dA, _dD], _fsLinks).files) === JSON.stringify([`${_dD}/a3.output`])
      && JSON.stringify(agentReturnSource(_tx, [_dA, _dD], { ..._fsLinks, real: (p) => p }).files) === JSON.stringify([`${_dA}/a2.output`, `${_dD}/a3.output`]));
  }
  t("shingles (REAL bodyShingles): reworded persist hits ≥3 four-word runs; disjoint control hits 0",
    _sh.length >= 20 && _hitsTP >= 3 && _hitsCtl === 0);
  // (7c) HOME CLASS (REAL classifyShingleEvidence + the two pathspecs, § HOME CLASS). The SAME six
  //      shingle hits credit LIKELY-REWRITTEN from a memory-class home and ECHOED-IN-ARTIFACT from an
  //      artifact-class one; nothing credits from neither. Mutation: route artifact hits into
  //      `rewritten`, or move `'plans/*.md'` out of ARTIFACT_HOMES → a row RED.
  const _six = new Set(_sh.slice(0, 6));
  t("home class (REAL classifyShingleEvidence): memory-class hits → rewritten; the SAME hits artifact-only → echoed; none → none",
    classifyShingleEvidence(_sh, _six, new Set()).verdict === "rewritten"
    && classifyShingleEvidence(_sh, new Set(), _six).verdict === "echoed"
    && classifyShingleEvidence(_sh, new Set(), new Set()).verdict === "none");
  t("home class (REAL pathspecs): plans/ src/ tests/ scripts/ hooks and locale bundles are artifact-class, MEMORY shards / rules / DECISIONS / todo / SKILL specs memory-class, and the two partition DURABLE_HOMES",
    ["'plans/*.md'", "'src/**'", "'tests/**'", "'scripts/*'", "'.claude/hooks/*.sh'", "'messages/*.json'"].every((h) => ARTIFACT_CLASS_PATHSPEC.split(" ").includes(h) && !MEMORY_CLASS_PATHSPEC.split(" ").includes(h))
    // EXACT set, not a sample: the memory class is DURABLE_HOMES minus ARTIFACT_HOMES, so a home added to
    // DURABLE_HOMES lands memory-class (CREDITING) by default, and moving docs/orchestrator/project-memory into
    // ARTIFACT_HOMES passed a five-member sample. Classify every new durable home here, on purpose.
    && JSON.stringify(MEMORY_CLASS_PATHSPEC.split(" ").sort()) === JSON.stringify(["'.claude/skills/*/MEMORY*.md'", "'.claude/project-memory/*.md'", "'.claude/rules/*.md'", "DECISIONS.md", "todo.txt", "'.claude/docs/*.md'", "AGENTS.md", "CLAUDE.md", "'.claude/skills/*/SKILL.md'", ".claude/meta-corrections-registry.md", "'.claude/skills/*/references/*.md'", "'.claude/orchestrator/*.md'"].sort())
    && MEMORY_CLASS_PATHSPEC.split(" ").length + ARTIFACT_CLASS_PATHSPEC.split(" ").length === DURABLE_HOMES.length);
  // (7d) LENS-OWN CREDIT (REAL classifyBlockEvidence + lensOfSrc). The review's three
  //      fixtures, a seat's prose reworded into a todo row (17/51), a meta L-entry (18/51) and a review-ledger
  //      row (19/49), are memory-class hits that never reached the expert's own memory: each credited before
  //      (proved in the same row) and must read ECHOED once the block's expert is known. The same hits in the
  //      expert's OWN memory still credit, and an unknown expert keeps the memory-class credit.
  //      Mutation: make classifyBlockEvidence ignore lensSet, or lensOfSrc return null → a row RED.
  const _fx = (n, k) => { const sh = Array.from({ length: n }, (_, i) => `w${i} x${i} y${i} z${i}`); return [sh, new Set(sh.slice(0, k))]; };
  const _reviewFixtures = [_fx(51, 17), _fx(51, 18), _fx(49, 19)];
  t("lens-own credit (REAL classifyBlockEvidence): the review's todo-row 17/51, meta-entry 18/51 and ledger-row 19/49 hits credited under the class rule and read ECHOED once the block's expert is known",
    _reviewFixtures.every(([sh, hit]) => classifyShingleEvidence(sh, hit, new Set()).verdict === "rewritten"
      && classifyBlockEvidence(sh, new Set(), hit, new Set()).verdict === "echoed"));
  t("lens-own credit: the same hits in the expert's OWN memory credit rewritten; an unknown expert (null) keeps the memory-class credit; no hits anywhere reads none",
    _reviewFixtures.every(([sh, hit]) => classifyBlockEvidence(sh, hit, hit, new Set()).verdict === "rewritten"
      && classifyBlockEvidence(sh, null, hit, new Set()).verdict === "rewritten"
      && classifyBlockEvidence(sh, new Set(), new Set(), new Set()).verdict === "none"));
  {
    const _ld = mkdtempSync(join(tmpdir(), "wr-lens-"));
    try {
      mkdirSync(join(_ld, "skills", "qa-expert"), { recursive: true });
      writeFileSync(join(_ld, "skills", "qa-expert", "MEMORY.md"), "x");
      mkdirSync(join(_ld, "skills", "general-purpose-notes"), { recursive: true });
      mkdirSync(join(_ld, "store"));
      const _mk = (id, type) => {
        const tx = join(_ld, "store", `agent-${id}.jsonl`);
        writeFileSync(tx, "{}");
        if (type !== undefined) writeFileSync(join(_ld, "store", `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
        return tx;
      };
      const _S = join(_ld, "skills");
      t("lensOfSrc (REAL): an expert with a MEMORY file resolves; general-purpose, a dir with no MEMORY file, a missing meta, a .output source and a path-shaped type resolve to null",
        lensOfSrc(_mk("a1", "qa-expert"), _S) === "qa-expert"
        && lensOfSrc(_mk("a2", "general-purpose"), _S) === null
        && lensOfSrc(_mk("a3", "general-purpose-notes"), _S) === null
        && lensOfSrc(_mk("a4"), _S) === null
        && lensOfSrc(join(_ld, "store", "a5.output"), _S) === null
        && lensOfSrc(_mk("a6", "../skills/qa-expert"), _S) === null);
      // (7e) THE RUNTIME WIRING (REAL makeLensSetFor + classifyEmittedBlock over a throwaway repo): a block
      //      reworded into its expert's CURRENT SHARD credits; one quoted only in todo.txt reads ECHOED.
      //      Text MOVED from todo.txt into the shard does not credit (the moved-text case under the lens rule).
      //      Mutation: `const lens = null` in classifyEmittedBlock, the pathspec losing its `*`, or dropping
      //      `&& memorySet.has(x)` in classifyBlockEvidence → RED.
      const _R = join(_ld, "repo"), _g = (c) => execSync(c, { cwd: _R, encoding: "utf8", env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null" } });
      const _body = (p) => Array.from({ length: 60 }, (_, i) => `${p}${i}`).join(" ");
      mkdirSync(join(_R, ".claude/skills/qa-expert"), { recursive: true });
      const _moved = _body("moved").split(" ").slice(0, 24).join(" ");
      writeFileSync(join(_R, ".claude/skills/qa-expert/MEMORY.md"), "router\n"); writeFileSync(join(_R, "todo.txt"), "rows\n" + _moved + "\n");
      _g("git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm anchor");
      const _anchor = _g("git rev-parse HEAD").trim();
      writeFileSync(join(_R, ".claude/skills/qa-expert/MEMORY-ARCHIVE-2026-10-10.md"), _body("own").split(" ").slice(0, 24).join(" ") + "\n" + _moved + "\n");
      writeFileSync(join(_R, "todo.txt"), "rows\n" + _body("todo").split(" ").slice(0, 24).join(" ") + "\n");
      _g("git add -A && git commit -qm work");
      const _mem = addedEvidenceShingles(_g(`git diff -U0 ${_anchor}..HEAD -- ${MEMORY_CLASS_PATHSPEC}`));
      const _lsf = makeLensSetFor(_anchor, _R), _lo = (p) => lensOfSrc(p, join(_R, ".claude/skills"));
      const _v = (p, id) => classifyEmittedBlock({ body: _body(p), src: _mk(id, "qa-expert") }, _mem, new Set(), _lsf, _lo).ev.verdict;
      t("lens wiring (REAL makeLensSetFor + classifyEmittedBlock, throwaway repo): a persist into the expert's current shard credits; a todo-only quote reads ECHOED; text moved from todo.txt into the shard does not credit",
        _v("own", "b1") === "rewritten" && _v("todo", "b2") === "echoed" && _v("moved", "b3") !== "rewritten");
    } finally { rmSync(_ld, { recursive: true, force: true }); }
  }
  // (7b) MOVED TEXT IS NOT NEW TEXT (REAL addedEvidenceShingles). A verbatim
  //      move is a `-` in one file and a `+` in another and must contribute nothing; a line added
  //      in-window and never removed must contribute its own shingles. Mutation: drop the
  //      `removed` filter -> row RED.
  const _moved = "the scale agent count to volume threshold keyed on changed keys only";
  const _fresh = "gate the fan out on total source characters times locales instead";
  const _ev = addedEvidenceShingles(`--- a/x/SKILL.md\n+++ b/x/SKILL.md\n-${_moved}\n+pointer stub line here\n` +
    `--- /dev/null\n+++ b/x/references/y.md\n+${_moved}\n+${_fresh}`);
  t("evidence (REAL addedEvidenceShingles): a verbatim MOVE contributes 0 shingles; an in-window ADD contributes its own",
    bodyShingles(norm(_moved)).every((sh) => !_ev.has(sh)) && bodyShingles(norm(_fresh)).every((sh) => _ev.has(sh)));
  // (8) VERDICT tier (REAL deriveVerdict): a downgrade with zero
  //     hard findings must read REVIEW, never CLEAN (the fuzzy matcher emptied `accused`, so
  //     CLEAN here is a green the matcher awarded itself); findings still outrank it; a
  //     clean run stays CLEAN. Mutation: revert deriveVerdict's REVIEW branch → row 1 RED.
  t("verdict (REAL deriveVerdict): ≥1 downgrade + 0 findings → REVIEW (never CLEAN/ok:true)",
    deriveVerdict(0, 0, 1) === "REVIEW");
  t("verdict (REAL deriveVerdict): findings outrank downgrades; zero-everything stays CLEAN",
    deriveVerdict(0, 1, 1) === "DELTA" && deriveVerdict(1, 0, 1) === "BLIND" && deriveVerdict(0, 0, 0) === "CLEAN");
  // (9) CORPUS GLOB — the arm this file lacked, and the reason the post-split MEMORY.md glob regression survived a week.
  //     Arms (1)-(2) validate containment LOGIC against a SYNTHETIC literal (`const mem = norm("## …")`),
  //     so a regression in the GLOB THAT BUILDS THE CORPUS is invisible to them BY CONSTRUCTION. That is
  //     exactly how the fallback kept globbing `MEMORY.md` after the 2026-08-06 two-tier split moved every
  //     body out to `MEMORY-ARCHIVE-<from>-<to>.md` shards: every arm stayed green over a hand-written
  //     string while the real corpus went 77.6% blind.
  //     READ-ONLY BY DESIGN — the needle is DERIVED from what is already on disk, never PLANTED. Planting
  //     into a real shard would write to the durable ledger during a test, and a crash between plant and
  //     cleanup leaves a fabricated heading in memory permanently (this corpus has a whole class about
  //     restore-halves that fail). Deriving cannot corrupt, needs no cleanup, and is strictly stronger:
  //     it proves the glob credits REAL archived content, not content the test just created.
  //     MUTATION-VALID FOR EXACTLY ONE GLOB, AND THE SENTENCE HERE USED TO CLAIM MORE (measured
  //     2026-08-13 per-site in a detached worktree, content-keyed on apply and restore):
  //         buildMemoryCorpus() cat-glob                  -> arm RED   <- the only site this arm reaches
  //         else-if(anchor) FALLBACK git diff             -> ALL PASS   <- and this is the fallback fix's OWN site
  //         wider git-diff glob (MEMORY_CLASS_PATHSPEC)   -> ALL PASS
  //     So reverting that fallback fix re-blinds the fallback with this suite fully GREEN. The old wording
  //     ("unstar EITHER corpus glob and this arm goes RED") would have had the next maintainer read
  //     the two git-diff globs as arm-guarded, which is how the week-blind incident recurs with more confidence
  //     than the first time. Unstar buildMemoryCorpus()'s glob -> RED, because the needle is CHOSEN to exist only in a shard
  //     and in no router. The anchor fallback is still UNGUARDED (the wider glob has since been pinned by
  //     arms 7c and 7e); extracting the pathspec pair as one
  //     shared datum would make the stronger sentence true by construction (~10-12 LOC, Rule of Three
  //     passes at 3 instances, tidy-AFTER) — filed, not done here.
  {
    const shq = (c) => { try { return execSync(c, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }); } catch { return ""; } };
    const routers = shq(`cat .claude/skills/*/MEMORY.md 2>/dev/null`);
    const shards = shq(`cat .claude/skills/*/MEMORY-ARCHIVE-*.md 2>/dev/null`);
    const projmem = shq(`cat .claude/project-memory/*.md 2>/dev/null`);
    // Exclusion set must cover the WHOLE corpus the glob credits, not just the routers — the cat-glob
    // in buildMemoryCorpus() reads project-memory too, so a needle present there is not shard-exclusive and the arm
    // stops discriminating. Prefer a DATED heading: a bare `.find` on the first
    // `^## ` lands on generic boilerplate, which is the class most likely to also exist elsewhere.
    const heads = (shards.match(/^## .+$/gm) || []).filter(
      (h) => h.trim().length >= 12 && !routers.includes(h) && !projmem.includes(h),
    );
    const needle = heads.find((h) => /\d{4}-\d{2}-\d{2}|^## L\d+/.test(h)) || heads[0];
    if (!needle) {
      // NOT a t() pass — a vacuous green here would advertise coverage the run did not have.
      console.log("SKIP  corpus glob: no shard-only heading on disk to discriminate with (not a pass)");
    } else {
      const corpus = buildMemoryCorpus();   // the REAL builder, not a replica
      t(`corpus glob (REAL) reaches MEMORY-ARCHIVE shards — needle exists only in a shard: "${needle.slice(3, 43)}"`,
        corpus.includes(needle));
    }
    // (9b) references/ — added 2026-09-26 when the wrap + expert-review specs moved narrative and
    //      conditional bodies verbatim into references/. Same READ-ONLY derivation: the needle is a
    //      line that exists in a references file and in NO other file the corpus globs, so dropping
    //      the references glob from buildMemoryCorpus() turns this arm RED.
    const refs = shq(`cat .claude/skills/*/references/*.md 2>/dev/null`);
    const others = shq(`cat .claude/skills/*/SKILL.md .claude/rules/*.md .claude/orchestrator/*.md .claude/docs/*.md AGENTS.md CLAUDE.md DECISIONS.md todo.txt .claude/meta-corrections-registry.md 2>/dev/null`);
    const refNeedle = (refs.match(/^.{40,}$/gm) || []).find(
      (l) => !routers.includes(l) && !shards.includes(l) && !projmem.includes(l) && !others.includes(l),
    );
    if (!refNeedle) {
      console.log("SKIP  corpus glob: no references-only line on disk to discriminate with (not a pass)");
    } else {
      t(`corpus glob (REAL) reaches skills/*/references — needle exists only in a references file: "${refNeedle.slice(0, 40)}"`,
        buildMemoryCorpus().includes(refNeedle));
    }
    // (9c) A root holding ONE rules file and none of the other members still yields that file.
    {
      const d = mkdtempSync(join(tmpdir(), "wr-corpus-"));
      try {
        mkdirSync(join(d, ".claude", "rules"), { recursive: true });
        writeFileSync(join(d, ".claude", "rules", "only.md"), "## corpus-partial-needle-7f3\n");
        t("corpus survives a missing member: a root with only one rules file still yields it",
          buildMemoryCorpus(d).includes("corpus-partial-needle-7f3"));
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
  }
  // (10) DEEP-PASS COVERAGE. Consumes the REAL module-scope helpers, never a replica —
  //      neuter either one and these rows go RED.
  // ⛔ THE FIXTURES ARE BUILT BY CONCATENATION ON PURPOSE. This file's own text can reach a
  //    transcript (any `cat` of it during a wrap, or a --self-test run whose arm names get
  //    echoed), and `raw` is exactly what these detectors scan. A rendered fixture would
  //    therefore supply a PLAN COUNT and extra RANGES to a later real run — inflating the
  //    dispatched side, i.e. failing OPEN, on the one gate that exists to catch a shortfall.
  //    Describe the shape, never render it: same discipline as the `wrap-dp-<i>` bracket rule.
  const _dpTok = "wrap-dp-" + "plan:";
  const _sedTok = "sed" + " -n ";
  const dpFix = (n, ranges) =>
    `${_dpTok} ${n} slices covering 1-8658\n` +
    ranges.map(([a, b]) => `${_sedTok}'${a},${b}p' x.jsonl`).join("\n");
  // (10a) the planned count is READ from the planner's own line.
  t("deep-pass coverage: planner's slice count parses", dpPlannedSlices(dpFix(12, [])) === 12);
  // (10b) THE DISCRIMINATING CONTROL, and the reason this gate is not self-satisfying: the
  //       spec's worked example uses a BRACKET placeholder, which must NOT parse. If this
  //       row ever goes green-by-matching, wrap/SKILL.md is arming the gate it documents.
  t(
    "deep-pass coverage: BRACKET placeholder in the spec does NOT count as a plan (self-match guard)",
    dpPlannedSlices(`${_dpTok} <N> slices covering <first>-<last>`) === null,
  );
  // (10c/d) DISPATCHED comes from the dispatch ledger, scoped to this session and to records
  //       at or after the plan statement (see DP_LEDGER). Fixture sids are invented.
  const _S = "fixture-sid-a", _T0 = Date.parse("2026-01-01T10:00:00.400Z");
  const _led = (agent, sec, extra = {}) => JSON.stringify({
    ts: new Date(Math.floor(_T0 / 1000) * 1000 + sec * 1000).toISOString().replace(".000Z", "Z"),
    sid: _S, decision: "allow", agent, ...extra });
  const _slices = (k, from = 1) => Array.from({ length: k }, (_, i) => _led(`Deep-pass slice ${String(i).padStart(2, "0")}`, from + i));
  t("deep-pass coverage: 12 planned / 10 slice agents in the ledger is a SHORTFALL",
    dpLedgerDispatches(_slices(10), _S, _T0).dispatched === 10);
  t("deep-pass coverage: a RETRIED slice collapses onto its id (3 agents + 1 retry = 3)",
    dpLedgerDispatches([..._slices(3), _led("Deep-pass slice 02 (retry)", 9)], _S, _T0).dispatched === 3);
  // What the old counter counted is not a dispatch: nothing but ledger records of THIS
  //       session, AT OR AFTER the plan, NAMED as a slice and NOT denied can raise the count.
  t("deep-pass coverage: another session, an earlier wrap, a non-slice agent and a DENIED call all read 0",
    dpLedgerDispatches([
      _led("Deep-pass slice 00", 1, { sid: "fixture-sid-b" }),
      _led("Deep-pass slice 01", -5),
      _led("uncle-bob lens on the diff", 2),
      _led("Deep-pass slice 03", 3, { decision: "deny" }),
    ], _S, _T0).dispatched === 0);
  t("deep-pass coverage: a denied slice is COUNTED as denied, so the finding can name it",
    dpLedgerDispatches([_led("Deep-pass slice 03", 3, { decision: "deny" })], _S, _T0).denied === 1);
  t("deep-pass coverage: a dispatch in the plan's own second counts (the ledger stamps whole seconds)",
    dpLedgerDispatches([_led("Deep-pass slice 00", 0)], _S, _T0).dispatched === 1);
  t("deep-pass coverage: the naming variants live in the ledger resolve to a slice id",
    dpSliceId("Wrap deep-pass slice 4") === "4" && dpSliceId("Deep-pass scan slice-07") === "7"
    && dpSliceId("Deep-pass slice s3 (wrap)") === "s3" && dpSliceId("Deep-scan slice 2 of 9") === "2"
    && dpSliceId("Residual triage w1 slice 2") === null && dpSliceId("Deep-pass slice of the tail") === null);
  // (10e/f) DECLARED residue suppresses the accusation. Concat-built for the same reason as
  //       above, and here the direction is sharper: this detector SILENCES a finding, so a
  //       rendered fixture reaching a transcript would fail OPEN on a real shortfall.
  // (10g/h/i) the corpus is ASSISTANT TEXT, and the last plan wins. A tool_use or
  //       tool_result carrying the line is a PROBE or an ECHO, never a statement.
  const _dpRec = (type, block) => JSON.stringify({ type, message: { content: [block] } });
  const _dpProbe = _dpRec("assistant", { type: "tool_use", input: { command: `grep -c -F '${_dpTok} 7 slices' x` } });
  const _dpEcho = _dpRec("user", { type: "tool_result", content: `${_dpTok} 11 slices covering 1-9` });
  const _dpSaid = (n) => _dpRec("assistant", { type: "text", text: `${_dpTok} ${n} slices covering 1-9` });
  t("deep-pass coverage: a PROBE for the plan line and a tool_result ECHO do NOT count as a plan",
    dpPlanScan([_dpProbe, _dpEcho]).n === null);
  t("deep-pass coverage: a plan stated in assistant text counts (positive control for the arm above)",
    dpPlanScan([_dpProbe, _dpSaid(5)]).n === 5);
  t("deep-pass coverage: a re-wrapped session's LAST stated plan wins",
    dpPlanScan([_dpSaid(7), _dpEcho, _dpSaid(5)]).n === 5);
  // The record-type filter on its own: a USER record with a plain TEXT block.
  t("deep-pass coverage: a USER record whose TEXT block carries the line is NOT a plan",
    dpPlanScan([_dpRec("user", { type: "text", text: `${_dpTok} 11 slices covering 1-9` })]).n === null);
  t("deep-pass coverage: a plan only in a THINKING block is NOT a plan",
    dpPlanScan([_dpRec("assistant", { type: "thinking", thinking: `${_dpTok} 4 slices covering 1-9`, text: `${_dpTok} 4 slices` })]).n === null);
  t("deep-pass coverage: the plan's own record timestamp scopes the ledger read",
    dpPlanScan([JSON.stringify({ type: "assistant", timestamp: "2026-01-01T10:00:00.400Z",
      message: { content: [{ type: "text", text: `${_dpTok} 3 slices` }] } })]).ms === _T0);
  // Live formats: emphasis or a backtick before the count, and the singular.
  t("deep-pass coverage: bold, backtick and singular plan formats parse",
    dpPlannedSlices(`${_dpTok} **5** slices covering 1-9`) === 5
    && dpPlannedSlices(`${_dpTok} \`6\` slices`) === 6
    && dpPlannedSlices(`${_dpTok} 1 slice covering 1-9`) === 1);
  const _regTok = "line region ";
  t("deep-pass coverage: a declared unread region (real digits) is recognised",
    dpDeclaredResidue(`${_regTok}7001-8658 unscanned`) === true);
  t("deep-pass coverage: the spec's LETTER placeholder does NOT count as a declaration (self-match guard)",
    dpDeclaredResidue(`${_regTok}N-M unscanned`) === false);
  // The --sonnet stop's halted wave: one dispatch, plan stated, region declared.
  t("deep-pass skip verdict: a halted wave with a plan AND a declared region reads HALTED, not skipped",
    dpSkipVerdict({ fired: true, ran: false, planned: 17, declared: true }) === "halted");
  t("deep-pass skip verdict: no plan line stays SKIPPED",
    dpSkipVerdict({ fired: true, ran: false, planned: null, declared: true }) === "skipped");
  t("deep-pass skip verdict: a plan with no declared region stays SKIPPED",
    dpSkipVerdict({ fired: true, ran: false, planned: 17, declared: false }) === "skipped");
  t("deep-pass skip verdict: a pass that ran, or did not fire, has no skip verdict",
    dpSkipVerdict({ fired: true, ran: true, planned: 17, declared: false }) === null
    && dpSkipVerdict({ fired: false, ran: false, planned: null, declared: false }) === null);
  // (10j-o) THE PLAN'S SECOND SOURCE (2026-09-30). The wrap boundary, the returns-dir choice,
  //       the slice-file parse and the source choice — each with the arm that must read the
  //       OTHER way. Marker literals concatenated, as above.
  const _wrapCmd = "<command-" + "name>/wrap</command-" + "name>";
  const _uRec = (ts, content, extra = {}) => JSON.stringify({ type: "user", timestamp: ts, message: { content }, ...extra });
  const _W1 = "2026-01-01T09:00:00.000Z", _W2 = "2026-01-01T12:00:00.500Z";
  t("deep-pass plan source: the LAST /wrap invocation is the boundary (typed record, and a skill-body injection)",
    dpLastWrapMs([_uRec(_W1, _wrapCmd), _uRec(_W2, `<command-message>wrap</command-message>\n${_wrapCmd}`)]) === Date.parse(_W2)
    && dpLastWrapMs([_uRec(_W2, [{ type: "text", text: "Base directory for this skill: /r/.claude/skills/wrap\n\n# Wrap" }], { isMeta: true })]) === Date.parse(_W2)
    && dpLastWrapMs([_uRec(_W1, _wrapCmd), _uRec(_W2, "Skill /wrap is " + "already loaded above; instructions unchanged.", { isMeta: true })]) === Date.parse(_W2));
  t("deep-pass plan source: a probe's output, a compaction summary and another skill's body quoting the marker are NOT a /wrap",
    Number.isNaN(dpLastWrapMs([
      // a text block beside the tool_result, so the tool_result skip is what excludes it
      _uRec(_W2, [{ type: "tool_result", content: _wrapCmd }, { type: "text", text: _wrapCmd }]),
      _uRec(_W2, `summary quoting ${_wrapCmd}`, { isCompactSummary: true }),
      _uRec(_W2, [{ type: "text", text: `Base directory for this skill: /r/.claude/skills/deep-pass\n\n${_wrapCmd}` }], { isMeta: true }),
    ])));
  const _w2 = Date.parse(_W2);
  t("deep-pass plan source: the returns dir from an EARLIER wrap is rejected; this wrap's newest is chosen",
    dpCurrentReturnsRun([Math.floor(Date.parse(_W1) / 1000) + 60], _w2) === null
    && dpCurrentReturnsRun([Math.floor(Date.parse(_W1) / 1000) + 60, Math.floor(_w2 / 1000) + 30, Math.floor(_w2 / 1000) + 90], _w2) === Math.floor(_w2 / 1000) + 90
    && dpCurrentReturnsRun([Math.floor(_w2 / 1000) + 30], NaN) === null);
  const _sf = (i, a, b, st = "returned") => ({ name: `slice-${String(i).padStart(2, "0")}.md`, text: `range: ${a}-${b}\nstatus: ${st}\n\nreport` });
  const _fp = dpReturnsPlan([_sf(0, 1, 364), _sf(1, 365, 1091), _sf(2, 1092, 1694), { name: "notes.txt", text: "range: 1-9" }]);
  t("deep-pass plan source: three contiguous returned slice files read as a plan of 3 over 1-1694, other files ignored",
    _fp.n === 3 && _fp.first === 1 && _fp.last === 1694 && _fp.gaps === 0 && !_fp.pending.length && !_fp.noRange.length);
  const _fq = dpReturnsPlan([_sf(0, 1, 364), _sf(1, 400, 900, "dispatched"), { name: "slice-02.md", text: "status: returned" }]);
  t("deep-pass plan source: a gap, a slice still `dispatched` and a file with no range are each named; an empty dir is null, not 0",
    _fq.gaps === 1 && _fq.pending.join() === "slice-01.md" && _fq.noRange.join() === "slice-02.md"
    && dpReturnsPlan([]) === null && dpReturnsPlan([{ name: "x.md", text: "" }]) === null);
  // The five range headers live stubs on this box carry: four parse, and the
  // one that cannot is reported as no-range, which makes the span UNVERIFIED, never a finding.
  const _hdr = (i, r) => ({ name: `slice-${String(i).padStart(2, "0")}.md`, text: `${r}\nstatus: returned\n` });
  const _fr = dpReturnsPlan([_hdr(0, "range: 8208-9073"), _hdr(1, "range: transcript lines 9074-9500"),
    _hdr(2, "range: stripped lines 9501-9900 (after the checkpoint)"), _hdr(3, "range: lines 9901-10200"),
    _hdr(4, "range: slice-04-10201-10500")]);
  t("deep-pass plan source: four live range formats parse contiguously; `slice-NN-a-b` is no-range, not a gap",
    _fr.n === 5 && _fr.first === 8208 && _fr.last === 10200 && _fr.gaps === 0 && _fr.noRange.join() === "slice-04.md"
    && dpReturnsPlan([_hdr(0, "range: 1-9"), { name: "slice-01.md", text: "range: 10-19\nStatus: Dispatched\n" }]).pending.join() === "slice-01.md");
  // A wave never dispatched shows only as the last range stopping short of the transcript.
  t("deep-pass plan source: a shortfall wider than a median slice is flagged, a small tail is not, an unparsed range gives no verdict",
    dpUnfiredSlack(1694 + 700, _fp)?.flagged === true && dpUnfiredSlack(1694 + 40, _fp)?.flagged === false
    && dpUnfiredSlack(99999, _fr) === null
    && dpLinesAt([JSON.stringify({ timestamp: _W1 }), "not json", JSON.stringify({ timestamp: _W2 })], Date.parse(_W1) + 1) === 1);
  // The main-body pieces, now at module scope.
  t("deepPassRan: this wrap's slice files count as a run; none and no dispatch is not",
    dpRanThisWrap([], { ms: NaN, idx: -1 }, { n: 1 }) === true && dpRanThisWrap([], { ms: NaN, idx: -1 }, null) === false);
  const _agent = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Agent",
    input: { description: "Deep-pass slice 00", prompt: "read your slice of x.jsonl" } }] } });
  const _scoped = [_agent, _agent, _uRec(_W2, _wrapCmd)];
  t("deepPassRan: two slice dispatches BEFORE this wrap began do not count for it; with no boundary they do",
    dpRanThisWrap(_scoped, dpLastWrap(_scoped), null) === false
    && dpRanThisWrap(_scoped, { ms: NaN, idx: -1 }, null) === true);
  t("deepPassRan: one slice dispatch and no slice files is not a run (the >= 2 threshold)",
    dpRanThisWrap([_agent], { ms: NaN, idx: -1 }, null) === false);
  t("deep-pass file finding: a never-returned slice or a gap between PARSED ranges is a finding; an unparsed range is not",
    dpFileIncomplete(_fq) === true
    && dpFileIncomplete({ pending: [], gaps: 2, noRange: ["slice-04.md"] }) === false
    && dpFileIncomplete({ pending: [], gaps: 1, noRange: [] }) === true
    && dpFileIncomplete(_fp) === false);
  // THE ARM THIS FALLBACK EXISTS FOR: the plan line absent from the transcript, the files present.
  const _noLine = { n: null, ms: NaN };
  t("deep-pass plan source: plan line ABSENT from the transcript + this wrap's slice files present → the plan is read from the files",
    (() => { const p = dpChoosePlan({ transcript: _noLine, wrapMs: _w2, file: _fp, fileRunMs: _w2 + 30000 });
      return p.source === "file" && p.n === 3 && p.ms === _w2 + 30000; })());
  t("deep-pass plan source: a transcript plan from THIS wrap wins over the files; one from an EARLIER wrap is not used",
    dpChoosePlan({ transcript: { n: 9, ms: _w2 + 5000 }, wrapMs: _w2, file: _fp, fileRunMs: _w2 + 30000 }).source === "transcript"
    && dpChoosePlan({ transcript: { n: 4, ms: Date.parse(_W1) + 5000 }, wrapMs: _w2, file: null, fileRunMs: NaN }).n === null
    && dpChoosePlan({ transcript: { n: 4, ms: Date.parse(_W1) + 5000 }, wrapMs: NaN, file: null, fileRunMs: NaN }).n === 4);
  // Estimated plan clock labels: both
  // hand-typed shapes flag, an exact reading does not, and a timestamp-embedded one still flags.
  t("clock labels: a tilde estimate and a rounded minute both flag, one line each",
    estimatedClockLabels("APPROVED ~18:50Z\nreadouts of 15:5xZ").length === 2);
  t("clock labels: a rounded minute inside an ISO timestamp flags",
    estimatedClockLabels("### Closability — 2026-09-30T20:2xZ").length === 1);
  t("clock labels: exact readings do NOT flag",
    estimatedClockLabels("committed 20:09Z, typed 20:10:36Z, 2026-09-30T14:43:32Z").length === 0);
  const _wr = Date.parse("2026-10-03T03:34:43Z");
  t("future stamps: a dated line typed 16 min ahead of its write time flags, with the gap",
    JSON.stringify(futureStampedLines(["- 2026-10-03T03:50Z — staging build Ready"], [_wr])) === JSON.stringify([{ line: 1, aheadMin: 15 }]));
  t("future stamps: a stamp at or before its write time, or within 60 s, does NOT flag",
    futureStampedLines(["- 2026-10-03T03:34Z — x", "### 2026-10-03T03:35Z — y", "- 2026-10-03T03:20Z — z"], [_wr, _wr, _wr]).length === 0);
  t("future stamps: an undated line, or one with no write time, does NOT flag",
    futureStampedLines(["plain prose 03:50Z", "- 2026-10-03T09:00Z — no blame"], [_wr, NaN]).length === 0);
  t("future stamps: 2 min ahead flags, in the dash, heading, bold and seconds forms",
    futureStampedLines(["- 2026-10-03T03:37Z — a", "### 2026-10-03T03:37Z — b", "- **2026-10-03T03:37Z, c**", "- 2026-10-03T03:36:50Z — d"], [_wr, _wr, _wr, _wr]).length === 4);
  const _lp = (sha, t, body) => `${sha.repeat(40)} 1 1 1\nauthor x\ncommitter-time ${t}\nfilename p.md\n\t${body}\n`;
  t("blame times: one per content line, each from its OWN header, capped at the mtime",
    JSON.stringify(blameWriteTimes(_lp("a", 1000, "A") + _lp("b", 2000, "B") + _lp("a", 1000, "C"), 1_500_000)) === JSON.stringify([1_000_000, 1_500_000, 1_000_000]));
  t("blame times: a group with no committer-time of its own (plain --porcelain) is NaN, never the previous commit's time",
    Number.isNaN(blameWriteTimes(_lp("a", 1000, "A") + _lp("b", 2000, "B") + `${"a".repeat(40)} 3 3 1\n\tC\n`)[2]));
  const _pl = "- 2026-10-03T03:05Z — typed ahead, committed later";
  const _txr = (ts, input, name = "Bash") => JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", name, input }] } });
  const _tw = transcriptWriteTimes([_txr("2026-10-03T02:50:00Z", { file_path: "/r/notes.md", new_string: `${_pl} (copied from plans/p.md)` }, "Edit"),
    _txr("2026-10-03T02:59:45Z", { command: `cat >> plans/p.md <<'EOF'\n${_pl}\nEOF` }),
    _txr("2026-10-03T03:30:00Z", { file_path: "/r/plans/p.md", new_string: _pl }, "Edit")], "p.md", [_pl, "plain"]);
  t("transcript times: the earliest write TO THIS PLAN carrying the line — not another file's, not a later edit",
    _tw[0] === Date.parse("2026-10-03T02:59:45Z") && Number.isNaN(_tw[1]));
  t("clock labels: the non-Z zones, a tilde range, HH:xxZ, ≈ and a bare rounded minute flag, one line each",
    estimatedClockLabels("05:4x CEST\n~12:40 local\n~08:45-09:10Z\n10:xxZ\n≈14:05Z\nat 13:0x").length === 6);
  t("clock labels: every label on a line is listed, not only the first",
    estimatedClockLabels("~15:07 and ~20:53").map((h) => h.labels.length).join() === "2");
  t("clock labels: a longer digit run or a hex tail is not a label",
    estimatedClockLabels("offset ~12:345 ms, register 12:0x1f").length === 0);
  // Iron Law #6 leg. ONE fixture, and each filter has a record that only it excludes: an earlier full
  // wrap's /decisions (the boundary), a peer session's /decisions (the session), a /session-memory between the
  // full wrap and a later --checkpoint (the checkpoint exclusion). A record split by a raw newline holds this
  // session's /decisions and is still MISSING — the stated limit, counted rather than solved.
  {
    const rec = (hms, skill, a = "", session = "sess-a") => JSON.stringify({ ts: `2026-10-10T0${hms}Z`, skill, args: a, session });
    const log = [rec("1:00:00", "wrap"), rec("1:05:00", "decisions"), rec("2:00:00", "wrap"), rec("2:00:30", "hanging-work"), rec("2:01:00", "session-memory"), rec("2:29:00", "me", "learn-session"),
      rec("2:30:00", "wrap", "--checkpoint --light"), rec("2:31:00", "meta", "learn"), rec("2:32:00", "meta", "post-compact"),
      rec("2:33:00", "decisions", "", "sess-b"), '{"ts":"2026-10-10T02:34:00Z","skill":"decisions","args":"split', 'here","session":"sess-a"}', ""].join("\n");
    const g = wrapSubSkillGaps(log, "sess-a");
    t("sub-skills: learn present, decisions absent since the last full /wrap → exactly 1 MISSING, unparsed lines counted",
      JSON.stringify(g.missing) === '["/decisions"]' && g.since === "2026-10-10T02:00:00.000Z" && g.unparsed === 2 && g.heads === 1 && g.mine === 1);
    t("sub-skills: a meta that is not `learn` does not count; a session whose only /wrap is the bare `checkpoint` alias is N/A, not clean",
      JSON.stringify(wrapSubSkillGaps(log.replace('"learn"', '"post-compact"'), "sess-a").missing) === '["/meta learn","/decisions"]'
      && wrapSubSkillGaps(rec("3:00:00", "wrap", "checkpoint --light"), "sess-a").missing === null);
    t("sub-skills (W1): a /me that is not `learn-session` does not count",
      JSON.stringify(wrapSubSkillGaps(log.replace('"learn-session"', '"check"'), "sess-a").missing) === '["/decisions","/me learn-session"]');
    t("sub-skills (W1): a full /wrap with nothing after it names every WRAP_SUBSKILLS member, so dropping one from the list reds",
      JSON.stringify(wrapSubSkillGaps(rec("4:00:00", "wrap"), "sess-a").missing) === '["/hanging-work","/meta learn","/session-memory","/decisions","/me learn-session"]');
  }
  t("compacted: the deep-pass gate reads transcriptCompacted(lines), never the phrase regex",
    /^const compacted = transcriptCompacted\(lines\);$/m.test(readFileSync(fileURLToPath(import.meta.url), "utf8")));
  t("compacted: a transcript that only MENTIONS /compact and the continuation phrase reads false; a summary record or a boundary reads true",
    transcriptCompacted([JSON.stringify({ type: "user", isMeta: true, message: { content: 'run "/compact" — continued from a previous conversation <<autonomous-loop' } })]) === false
    && transcriptCompacted([JSON.stringify({ type: "user", isCompactSummary: true, message: { content: "x" } })]) === true
    && transcriptCompacted([JSON.stringify({ type: "system", subtype: "compact_boundary" })]) === true);
  console.log(ok ? "\nself-test: ALL PASS" : "\nself-test: FAILURES");
  process.exit(ok ? 0 : 1);
}

const sid = process.env.CLAUDE_CODE_SESSION_ID || "";
// The harness keys a project's dirs on its path with every non-alphanumeric character turned into `-`.
const PROJECT_KEY = REPO_ROOT.replace(/[^a-zA-Z0-9]/g, "-");
const PROJ = `${homedir()}/.claude/projects/${PROJECT_KEY}`;
const transcript = getArg("--transcript") || (sid ? `${PROJ}/${sid}.jsonl` : null);

// ── GATE: the post-compact marker ─────────────────────────────────────────────────────────────
// Read the marker BEFORE the transcript gate below, deliberately: an uncleared marker is a fact on
// disk, and it must surface even on the no-transcript early-exit path.
//
// WHY THIS LIVES HERE AND NOT IN A HOOK. `compact-save.sh` (PreCompact) stamps the marker;
// `post-compact-pending-check.sh` (UserPromptSubmit) re-surfaces it on every PROMPT. But a `/wrap`
// is ONE prompt and dozens of turns, so a prompt-keyed net can never interrupt a wrap already in
// flight. On 2026-07-10 an auto-compaction fired INSIDE a `/wrap` at 07:59:38Z; the directive
// printed at the top of a turn already committed to Step 0, and went unnamed for eleven tool calls
// — after the identical skip had already been corrected earlier the same session.
// It was not rationalized away; it was never considered. The procedure ate the interrupt.
//
// So the gate is COMPUTED here and the TOOL withholds `ok:true` while the marker stands.
// (It cannot literally stop the orchestrator typing ✅ — this is warn-mode, exit 0 always. The
// hard-stop is a Stop hook (`exit 2`), named below. The first version of this comment claimed
// "the wrap CANNOT print ✅", which is false at the behavioural layer.)
//
// The marker tracks "recovery decision made", NOT "brief produced" — an owner-curated
// `/compact <focus>` (marker shows `focus=yes`) is a sanctioned NAMED SKIP, and it STILL must clear
// the marker. So PRESENCE is the finding; `focus` only decides which action clears it.
//
// ⚠ GATE ON PRESENCE, NEVER ON CONTENT. v1 did `readFileSync(...).trim()` and tested the STRING —
// a 0-byte marker yields `""`, which is falsy, so the gate silently did not fire while the marker
// sat on disk, and the report printed `post-compact marker: cleared`. That input is REACHABLE from
// our own producer: `compact-save.sh` does `printf … > "$marker" … || true` — `>` truncates before
// `printf` writes, and `|| true` swallows a mid-write kill (which happens under memory pressure,
// i.e. during a compaction). The two weaker layers both key on presence correctly
// (`post-compact-pending-check.sh` uses `[ -f ]`); the strongest layer was the loosest.
const SID_SHAPE = /^[a-zA-Z0-9_-]+$/;   // mirrors BOTH writers' guards
const pendingPath = sid && SID_SHAPE.test(sid)
  ? join(REPO_ROOT, ".claude/state", `post-compact-pending-${sid}`)
  : null;
// Same sid guard, same directory: the breadcrumb /wrap Step 0 reads to distinguish "a recovery
// ran here" from "no compaction ever". Only interpolated into the printed remedy below — this
// script never writes it, so a null sid degrades to a remedy naming `null`, which is the same
// degradation `pendingPath` already has and is unreachable while `markerPresent` gates the call.
const clearedPath = sid && SID_SHAPE.test(sid)
  ? join(REPO_ROOT, ".claude/state", `post-compact-cleared-${sid}`)
  : null;
const markerPresent = !!(pendingPath && existsSync(pendingPath));
// A PRECOMPUTED compaction fires PreCompact at PREPARATION, so the marker can stand while no
// compaction has applied; /post-compact Step 1 then defers and deliberately leaves it, to wait
// for the real compaction. `status` exits 0 only
// when Step 1 deferred AND no boundary has landed since, so a real compaction still reads OWED.
// Any failure to ask (no python3, a crash) reads as OWED — the finding, the safe direction.
function deferralStatus(sidArg, txArg, stateDirArg) {
  try {
    execSync(`python3 ${JSON.stringify(join(REPO_ROOT, "scripts/post-compact-deferral.py"))} status --sid ${sidArg}`
      + (txArg ? ` --tx ${JSON.stringify(txArg)}` : "") + (stateDirArg ? ` --state-dir ${JSON.stringify(stateDirArg)}` : ""),
      { stdio: "ignore" });
    return true;
  } catch { return false; }
}
let markerDeferred = false;
if (markerPresent && sid && SID_SHAPE.test(sid)) {
  try {
    // Same transcript this script reads (`--transcript` honoured), so the two instruments cannot disagree.
    markerDeferred = deferralStatus(sid, transcript, null);
  } catch { markerDeferred = false; }
}
const markerOwed = markerPresent && !markerDeferred;
// Contents are ADVISORY (they pick the remedy). A read failure — EISDIR, a race against
// `post-compact-pending-check.sh`'s `find … -delete` — must never throw: `fail()` promises this
// tool never exits nonzero, and an uncaught readFileSync would wedge the very /wrap it guards.
let postCompactPending = null;
if (markerPresent) {
  try { postCompactPending = readFileSync(pendingPath, "utf8").trim(); } catch { postCompactPending = ""; }
}
// ⛔ FIELD-ANCHORED, NOT A BARE SUBSTRING (2026-09-09). This read
// `/focus=yes/` over the WHOLE marker line, which also carries `focus_args=<the operator's own
// text>` — so an argument merely CONTAINING the literal `focus=yes` flipped a genuine focus=no
// to skip-sanctioned. `compact-save.sh` now substitutes `=` out of that field as the second
// layer; this anchor is the first, and neither is sufficient alone.
const pendingFocus = /(?:^|\s)focus=yes(?:\s|$)/.test(postCompactPending || "") ? "yes" : "no";

function postCompactFinding() {
  const body = postCompactPending || "(marker present but EMPTY or unreadable — treat as focus=no)";
  return `⚠️  POST-COMPACT PENDING (${body}) → the Step-0 gate is UNRUN. `
    // ⛔ THE BREADCRUMB WRITE GOES IN FRONT OF THE `rm`, IN BOTH BRANCHES, AND IT IS NOT
    // BOOKKEEPING. /wrap Step 0's gate reads `post-compact-cleared-<sid>` to tell "a recovery
    // ran and cleared the marker" from "no compaction ever happened". Clearing with a BARE `rm`
    // — which is what this function used to print — leaves no breadcrumb, so those two worlds
    // produce byte-identical output and the gate cannot fail. Measured: arms C
    // (no compaction) and D (compaction, cleared via the printed `rm`) shared one md5. The
    // named-skip branch is the structural half: on focus=yes the agent never invokes
    // `/meta post-compact`, so Step 7 — the only other site that writes it — is unreachable, and
    // that session prints ✅ CLEAR with certainty. Hence both branches, not just focus=no.
    + (pendingFocus === "yes"
        ? `focus=yes is NOT a skip grant — READ \`focus_args\` on the marker line above and JUDGE it. The flag records only that the /compact slot was non-empty, and a DIRECTIVE typed there (measured 2 of 2 in one session) reads identically to a curation of the cutoff. A directive ⇒ the skip is NOT eligible, run \`/post-compact\`. A genuine curation ⇒ NAME the skip. Either way: \`date -u +%FT%TZ > ${clearedPath} && rm ${pendingPath}\`.`
        : `focus=no → the skip gate does NOT hold. Run \`/post-compact\`, then \`date -u +%FT%TZ > ${clearedPath} && rm ${pendingPath}\`.`)
    + ` A prompt-keyed UserPromptSubmit net cannot re-fire inside a /wrap (one prompt, many turns).`;
}

function fail(msg) {
  // Warn-mode: never throw a nonzero — a broken reconciler must not wedge /wrap.
  // `findings` MUST be present even here: the verdict is computed from `findings` alone, and a
  // Stop-hook consumer parsing `.findings` would otherwise miss the marker on this path.
  // `skipped: []` is a LITERAL, not `smoke.skipped`, and it is truthful only because every fail() call
  // sits ABOVE the `const smoke =` / `const probe =` lines, so no probe can have run yet. A fail() moved
  // below them must report the real `smoke.skipped` (and `smoke` is not even defined up here).
  if (asJson) console.log(JSON.stringify({
    ok: null, note: msg, postCompactPending, pendingFocus, postCompactDeferred: markerDeferred, skipped: [],
    findings: markerOwed ? [postCompactFinding()] : [],
  }));
  else {
    if (markerOwed) console.log(`  ${postCompactFinding()}`);
    else if (markerDeferred) console.log(`  ℹ️  DEFERRED: the pre-compaction hook fired and no compaction has landed; the marker stands on purpose.`);
    console.log(`wrap-reconcile: ${msg} (skipped — warn-mode)`);
  }
  process.exit(0);
}

if (!transcript || !existsSync(transcript)) fail(`no transcript (${transcript || "no CLAUDE_CODE_SESSION_ID"})`);

// ⛔ V8 caps a string at 536,870,888 CHARS. A long-lived session's transcript grows past that
// (measured 2026-08-14: one seat at 439.6 M chars / 1.79 GB RSS for this read+split, ~15 MB/day
// → ~6 days of headroom). An UNCAUGHT ERR_STRING_TOO_LONG here would wedge the reconciler entirely;
// warn-mode demands a NAMED blind instead. Degrade loudly, never crash the gate.
let raw;
try {
  raw = readFileSync(transcript, "utf8");
} catch (e) {
  fail(`transcript unreadable in one string (${e.code || "read error"})`);
}
const lines = raw.split("\n").filter(Boolean);

// ── EMITTED side — count `### Memory Update` blocks with a NON-"None" body. ──
// The capture token is `### Memory Update`; the body an agent writes is a
// `## YYYY-MM-DD — Title` (or `## L#`/`## <topic>`) header. A "None — no
// significant decisions" body legitimately produces zero appends → subtract it.
// A REAL emitted block = `### Memory Update` immediately followed (within ~250
// chars, allowing JSONL escaping / whitespace) by a DATED or L# body header
// (`## YYYY-MM-DD` / `## L###`). This is the discriminator that separates an
// agent's actual emitted entry from the SPEC PROSE that merely *mentions*
// `### Memory Update` (the loaded skill specs + this discussion say the phrase
// dozens of times with NO body — the first-cut raw grep counted those: 84 vs ~10).
// CALIBRATION NOTE (warn-mode): this heuristic still over/under-counts at the
// margins (a spec's worked-EXAMPLE block, an agent that dates its body oddly);
// the block-mode promotion needs structural JSONL record-typing — see the header.
// EMITTED side — count from the PER-AGENT files, NOT the shared transcript. Each
// dispatched agent writes one `<sid>/subagents/agent-<id>.jsonl` (every tmp
// `<tasksDir>/<id>.output` is a symlink to it; agentReturnSource picks the source) =
// that agent's OWN return, free of the two pollution sources that defeated the
// transcript grep: the loaded SKILL.md specs (which describe `### Memory Update`)
// + the orchestrator's own quoting/discussion. Window by FILE MTIME to THIS
// wrap's segment (after the session-start anchor's commit time) so a prior wrap's
// agents don't inflate. Tail-read (the Memory Update lands at the END of a return)
// so a 165K-token deep-pass transcript costs a `tail -c`, not a full read.
import { statSync } from "node:fs";
// Session-start anchor (shared by the emitted mtime-window + the persisted git-diff).
// REPO_ROOT-anchored, NOT cwd-relative (the file's own REPO_ROOT standard; measured 2026-07-13:
// run from /tmp the relative form missed the anchor AND the corpus cat (now buildMemoryCorpus()) returned empty →
// "0 persisted" = a cwd-dependent FALSE ACCUSATION of every emitted block).
const anchorFile = join(REPO_ROOT, ".claude/state", `session-start-sha-${sid}`);
const anchor = getArg("--anchor")
  || (sid && existsSync(anchorFile) ? readFileSync(anchorFile, "utf8").trim() : null);
let emitted = 0;
let emittedNone = 0;
let unclassified = 0; // `### Memory Update` present, not a None, but NO dated heading → ambiguous (undated block OR prose); reported, never silently resolved
const emittedHeaders = []; // normalized distinctive slice of each emitted block's `## <date/L#>` body header
const emittedBlocks = []; // {headerSlice, body} — bodies retained for the hub-relay shingle pass
let tasksNote = "";
let anchorTs = 0;
if (anchor) { try { anchorTs = parseInt(execSync(`git show -s --format=%ct ${anchor} 2>/dev/null`, { cwd: REPO_ROOT, encoding: "utf8" }).trim(), 10) || 0; } catch { /* leave 0 → no window */ } }
let sidTasksDir = null;
try {
  const cand = execSync(`ls -d /private/tmp/claude-*/${PROJECT_KEY}/${sid}/tasks 2>/dev/null | head -1`, { encoding: "utf8" }).trim();
  if (cand && existsSync(cand)) sidTasksDir = cand;
} catch { /* none */ }
// The session-uuid dir above is only the FIRST home: add every dir the transcript names.
const tasksDirs = collectTaskDirs(sidTasksDir, raw);
// The durable store beside the transcript wins when it exists; the tmp dirs are the fallback.
const agentReturns = agentReturnSource(transcript, tasksDirs);
// A BOOLEAN, not a path: the readers below ask "is the emitted side readable?", and a single-dir
// variable left beside the list invites the next reader to iterate the wrong one.
const hasTaskOutputs = agentReturns.dirs.length > 0;
// A real agent return is a JSONL sidechain transcript — its first record carries the isSidechain marker.
// A plain-text Bash/Monitor `.output` (which routinely carries the block-marker — a mail body quoting it,
// or this script's own printed report) does NOT. DELIBERATELY isSidechain-only, never `agentId` (which was
// once proposed): agentId is a COMMON token (mail, todos, agent discussion),
// so keying on it is contamination-prone. This SHRINKS the self-amplification, it does NOT fully close it —
// a contrived `.output` leading with the sidechain marker + carrying the block-marker in its tail could still
// slip; full closure needs structural JSONL record-typing (over-engineering for a local tool). Any residual
// OVER-counts, which fails loud ("the inconsistency IS the signal" — two consecutive runs disagreed 1→2).
function isAgentTranscript(p) {
  try { return execSync(`head -c 200 ${JSON.stringify(p)} 2>/dev/null`, { encoding: "utf8" }).includes('"isSidechain":true'); }
  catch { return false; }
}
if (hasTaskOutputs) {
  for (const p of agentReturns.files) {
    let mt = 0; try { mt = Math.floor(statSync(p).mtimeMs / 1000); } catch { continue; }
    if (anchorTs && mt < anchorTs) continue; // window to THIS wrap's agents
    if (!isAgentTranscript(p)) continue; // AGENT RETURNS ONLY — skip Bash/Monitor artifacts that merely PRINT the marker (see isAgentTranscript)
    let tail = "";
    try { tail = execSync(`tail -c 12000 ${JSON.stringify(p)} 2>/dev/null`, { encoding: "utf8", maxBuffer: 4 << 20 }); } catch { continue; }
    // ANCHOR the block scan to the LAST `### Memory Update` marker (2026-07-10).
    // Two separate bugs live here; the first fix caused the second.
    //
    // (a) The tail contains the agent's REPORT PROSE, which routinely carries its own
    //     `## …` / `## 2026-07-09 …` section headings BEFORE the marker. Scanning the
    //     whole tail grabbed a prose heading as the "block header", which then never
    //     content-matched into any MEMORY.md → a PHANTOM "1 block UN-PERSISTED".
    // (b) FIRST-match is wrong: an agent that QUOTES the marker (restating its instructions)
    //     and emits the real block later would be sliced at the quote. Agents emit the block
    //     at the END, so take the LAST occurrence.
    const blockAt = lastMarkerIdx(tail);   // shared primitive — see BLOCK-CLASSIFIER PRIMITIVES
    if (blockAt < 0) continue;
    // DE-ESCAPE before any word-boundary test. The .output is JSONL, so the text reads
    // `### Memory Update\nNone — no significant decisions`, where `\n` is a literal
    // BACKSLASH + n. That puts the escape's `n` directly against `None`, so `\bNone\b`
    // has NO word boundary and NEVER matched — `emittedNone` was structurally stuck at 0
    // for the life of this script, and the dated-header gate below was silently absorbing
    // every "None" block instead. (Found 2026-07-10 by testing the regex against a real
    // block rather than reasoning about it.)
    const block = deescape(tail.slice(blockAt));           // shared primitive
    if (isNoneSkip(block)) { emittedNone++; continue; }    // shared primitive
    // The dated-header test STAYS the count discriminator. It is what separates a real
    // emitted block from SPEC PROSE that merely describes `### Memory Update` (the file
    // header documents an earlier 33-vs-10 over-count from exactly that). Do NOT count on
    // block-presence alone — a Monitor/Bash `.output` quoting this script's own source
    // then reads as an emitted lesson.
    //
    // But do NOT silently skip the residual either. A block-marker present, not a None,
    // and no dated heading is genuinely AMBIGUOUS (an undated real block, or prose). Count
    // it as `unclassified` and SAY SO — the `unclassified:` discipline from
    // check-lesson-numbers.mjs: a detector that cannot see something must report its own
    // blind spot rather than resolve it silently in either direction.
    if (/##\s*(20\d\d-\d\d-\d\d|L\d{2,})/.test(block)) {
      emitted++;
      const mh = block.match(/##\s*(20\d\d-\d\d-\d\d[^"]{0,60}|L\d{2,}[^"]{0,60})/);
      if (mh) {
        const hs = norm(mh[1]).slice(0, 40);
        emittedHeaders.push(hs);
        // CARRY THE SOURCE (2026-09-07). The accusation below prints a
        // NORMALIZED 40-char slice — lowercased, punctuation stripped — and used to keep no
        // inverse, so its own "Enumerate + VERIFY each" instruction had no instrument behind
        // it. Measured that day on this session: 14 accused, and THREE probes failed to map a
        // single slice back to its block (reconstructed-fragment grep over the durable homes;
        // a `## 2026-…` regex over the session jsonl, 14 of 14 not found; the same regex over
        // the 379 task outputs, 14 of 14 again) — while a bare `grep -F` on one fragment DOES
        // hit those files, i.e. every zero was the probe, not the world. The file is in scope
        // right here at capture time, so this is a carry-through, never a search.
        emittedBlocks.push({ headerSlice: hs, body: block, src: p }); // the PATH: with extra dirs a basename no longer says which dir
      }
    } else unclassified++;
  }
} else tasksNote = "no subagents store and no per-agent tasks dir (falls back to transcript-blind — emit count unavailable)";

// ── PERSISTED side — SESSION-SCOPED content-match (fixed 2026-07-03). ──
// The old count was `git diff ${anchor}..HEAD` of ALL *MEMORY.md — but that range
// includes EVERY fleet session's commits (all authored by the same git user, so
// no author-filter separates them), so a heavily-persisting PEER inflated
// `persisted` and MASKED this session's OWN unpersisted blocks: the reconcile
// printed "no delta" while 4 agent Memory Updates were unsaved.
// Fix: count how many of MY emitted block headers now exist in a memory file — a
// CONTENT set-difference (what the header comment always promised), session-scoped
// by construction. Falls back to the old peer-inflated git-diff ONLY when the
// emitted side is blind (no tasks dir → no headers to match), flagged as such.
let persisted = null;
let anchorNote = "";
let persistNote = "";
// revisit-fix (2026-07-13): the tool HAS the unmatched headers — print them, so each block
// is verifiable in seconds instead of the aggregate being dismissed wholesale (the cry-wolf path).
let unmatchedHeaders = [];
if (hasTaskOutputs) {
  let mem = "";
  try { mem = normChunked(buildMemoryCorpus()); } catch { /* empty → 0 matches */ }
  persisted = emittedHeaders.filter((h) => h.length >= 8 && mem.includes(h)).length;
  unmatchedHeaders = emittedHeaders.filter((h) => !(h.length >= 8 && mem.includes(h)));
  persistNote = "content-matched (session-scoped)";
} else if (anchor) {
  try {
    const diff = execSync(
      `git diff ${anchor}..HEAD -- '.claude/skills/*/MEMORY*.md' '.claude/project-memory/*.md' 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    persisted = (diff.match(/^\+##\s/gm) || []).length;
    persistNote = "fleet-wide git-diff (PEER-INFLATED fallback — emitted side blind)";
  } catch { anchorNote = "git-diff-failed"; }
} else {
  anchorNote = "no session-start anchor (session-start.sh must stamp .claude/state/session-start-sha-<sid>)";
}

// ── Hub-relay persist model: three-way verdict ──
// The exact-match model above assumes the session that DISPATCHED an agent is the one that
// PERSISTS its Memory Update. True for a build session; FALSE BY CONSTRUCTION for a review
// hub, whose product is relayed to a delegator who codifies it in ITS OWN commits — measured
// ≥59% false-accusation across the only 2 real hub runs (L#-insertion + midnight-rollover +
// curated retitles compounding the relay blindness). Convergent fix: credit
// is granted ONLY on a ground-truth artifact hit — 4-word BODY shingles vs the ADDED lines of
// `git diff <anchor>` over the WIDENED durable-home set (memory + rules + DECISIONS.md +
// todo.txt + docs: a delegator codifies into rules/DECISIONS at least as often as MEMORY).
// Three-way: exact (header slice, above) / LIKELY-REWRITTEN (downgraded WITH its shingle
// receipt, never silently credited) / un-persisted. This is downgrade-with-receipt, NOT
// credit-without-provenance (review showed the git-diff fallback path already had that
// disease — an authorless fleet-wide count — and a gate that credits without evidence dies).
// The genuinely unmatchable residue stays: a relay the delegator codifies AFTER this wrap is
// a FUTURE event (a reviewer's dissent) — that shape keeps its cite-the-mail-id remedy below.
// Carries a shingle-pass instrument failure down to `blind` (declared further down, so a
// bare push here is a TDZ ReferenceError). Measured 2026-09-07: the catch below
// swallowed an ENOBUFS and every unmatched header stayed ACCUSED with no BLIND note —
// measured 52 of 52 false accusations at a 20-day anchor, on the gate that runs at the end
// of every wrap on every seat. This file's own makeProbe header already states the rule the catch
// broke: a probe that CANNOT RUN pushes to blindArr and must never silently pass.
const shingleBlind = [];
let likelyRewritten = [];
let echoedInArtifact = []; // artifact-class echoes — reported, never credited (§ HOME CLASS)
if (hasTaskOutputs && persisted != null && unmatchedHeaders.length > 0 && anchor) {
  let memSet = new Set(), artSet = new Set();
  try {
    // COMMITTED-ONLY evidence (`..HEAD`): the delegator's
    // durable home is a COMMIT; the working tree folds in
    // peers' in-flight MEMORY.md noise (measured: 104 uncommitted added lines at review time),
    // which inflates the false-credit rate for zero evidentiary value.
    const diffOut = execSync(
      // `MEMORY*.md`, not `MEMORY.md` — the 2026-08-06 two-tier split moved skill-memory
      // BODIES out to dated `MEMORY-ARCHIVE-<from>-<to>.md` shards, leaving `MEMORY.md` a
      // router. This glob kept naming the pre-split filename, so every block persisted into
      // a shard read as UN-PERSISTED. Measured 2026-08-12: of ten accused blocks, nine were
      // persisted and four of those sat in archive shards that the glob could not see.
      //
      // This is the representation-change class (`.claude/rules/bash-environment.md`): a
      // representation moved and every anchored instrument aimed at the old one silently
      // became a no-op. Note the failure DIRECTION here is a false ACCUSATION on a gate
      // whose whole job is to stop a wrap self-certifying — so it teaches "the delta is
      // noise", which is the cry-wolf death of the net.
      // ⛔ AND THE SAME CLASS AGAIN, ONE FILE OUT — measured 2026-08-13, 6 accused / 6 persisted,
      // a 100% false-accusation run. The set above enumerates where a lesson USUALLY lands and
      // omits `AGENTS.md`, which is the always-loaded behavioural spec every seat reads on every
      // turn. So the class of lesson MOST likely to be codified there — a rule binding every
      // session — was the class this gate could NEVER see. Measured destinations of the six:
      // AGENTS.md (+18 and +2), the corrections registry (+8), two SKILL.md specs, a script, and
      // a plans artifact. Not one was in the old pathspec.
      //
      // Direction is what makes it urgent, and it is the same direction as the MEMORY*.md miss
      // above: a false ACCUSATION on the one gate whose job is to stop a wrap self-certifying.
      // Six-for-six teaches the reader that the delta is noise, which is the cry-wolf death of
      // the net — and it does that most reliably to behavioural rules, the highest-stakes class.
      //
      // WIDENING THE FILE SET DOES NOT WEAKEN THE EVIDENCE BAR. Credit still requires a 4-word
      // BODY shingle against ADDED lines; this only changes WHERE that proof may be found. The
      // added globs are all genuine codification homes in this repo: always-loaded specs, skill
      // specs, the corrections registry, hooks and scripts (a lesson routinely BECOMES a guard),
      // and plans/ (where panel + process artifacts land).
      // `-U0` is information-free here — the only consumer is the `+`-line filter one line
      // below, so every context line is read and discarded. ⚠️ I ADDED IT AS A COST BOUND AND
      // MEASURED IT NOT BEING ONE: 146 s before, 170 s after, i.e. no improvement. Kept because
      // it is correct and free, but do NOT read it as the fix for the runtime — the cost is the
      // SHINGLE PASS below, not the diff (see the Set note there). Recording the failed
      // hypothesis rather than deleting it, because the next reader will otherwise reach for
      // exactly this lever again.
      `git diff -U0 ${anchor}..HEAD -- ${MEMORY_CLASS_PATHSPEC} 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
    );
    memSet = addedEvidenceShingles(diffOut);
    // The artifact-class diff is read SEPARATELY: its hits never credit a persist (§ HOME CLASS), they
    // only name what echoed the block's prose — so a reader can tell a verdict record from a MEMORY row.
    artSet = addedEvidenceShingles(execSync(
      `git diff -U0 ${anchor}..HEAD -- ${ARTIFACT_CLASS_PATHSPEC} 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
    ));
  } catch (e) {
    // ⛔ NOT "no evidence" — "the evidence could not be read". The 40 MiB maxBuffer is
    // reachable: a ~16-day anchor overflows it, so beyond that the pass silently stops
    // running and 100% of unmatched headers are accused. Say so; do not raise the buffer
    // here without re-calibrating the floors (the Set rewrite was measured crediting
    // 15 of 52 on a 30-day DISJOINT control against 0 of 52 pre-commit — the cliff is
    // currently MASKING that, so buffer-alone converts a false-accusation bug into a
    // false-credit one). Tracked separately; this half is safe alone because it cannot
    // make the shingle pass run.
    shingleBlind.push(
      `shingle pass could not run (${String((e && e.code) || (e && e.message) || e).slice(0, 60)}) ` +
        `— every unmatched block below is UN-DOWNGRADED, not un-evidenced`,
    );
  }
  if (memSet.size || artSet.size) {
    const still = [];
    // ── COST BOUND, and it is what actually moved the runtime (2026-09-07). ──
    // This pass was ~125 blocks × ~400 shingles = tens of thousands of `addedNorm.includes(s)`
    // substring scans over the whole added-line corpus, so widening the pathspec to `src/**`
    // scaled it multiplicatively: 146 s, past the Bash tool's 120 s default, which would make
    // `/wrap` Step 11 TIME OUT and return a void reading — the same shape as the defect this
    // wrap fixed in defer-trigger-scan. Precompute the added side's shingles ONCE and test
    // membership instead: **146 s → 38 s**, back inside the default with room.
    // ⛔ NOT A PURE OPTIMISATION, AND I WROTE THAT IT WAS BEFORE MEASURING IT. Both sides now
    // run through `bodyShingles`, which drops words ≤2 chars, so a 4-word run straddling a
    // dropped word matches here where `includes` would have missed it. Measured on this session
    // at the same anchor: **45 → 47 likely-rewritten, 7 → 5 accused** — two verdicts moved, and
    // both moved toward CREDIT, which is the safe direction on a gate with a documented 6-of-6
    // false-accusation run in its own header. If you ever need bit-identical semantics, the
    // `includes` form is the reference; this one is deliberately slightly more generous.
    // LENS-OWN CREDIT: makeLensSetFor + classifyEmittedBlock (module scope, self-test arm 7e).
    const lensSetFor = makeLensSetFor(anchor);
    for (const h of unmatchedHeaders) {
      const blk = emittedBlocks.find((b) => b.headerSlice === h);
      const { shingles, lens, ev } = classifyEmittedBlock(blk, memSet, artSet, lensSetFor);
      if (ev.verdict === "rewritten") {
        likelyRewritten.push({ header: h, hits: ev.hits, shingles: shingles.length, sample: ev.sample, lens });
      } else {
        if (ev.verdict === "echoed") echoedInArtifact.push({ header: h, hits: ev.hits, shingles: shingles.length, sample: ev.sample, lens });
        still.push(h);
      }
    }
    unmatchedHeaders = still;
  }
}

// ── DEEP-PASS trigger check (failure #2) — a mechanically-fired step must run. ──
const nLines = lines.length;
const compacted = transcriptCompacted(lines);
// A compaction is a RECORD, never a phrase: the old regex matched this spec's own prose and any tool output
// quoting it (three sessions hit it).
function transcriptCompacted(ls) {
  return ls.some((l) => {
    if (!l.includes('"isCompactSummary":true') && !l.includes('"compact_boundary"')) return false;
    try { const r = JSON.parse(l); return r.isCompactSummary === true || (r.type === "system" && r.subtype === "compact_boundary"); } catch { return false; }
  });
}
// ⛔ THE UNIT IS BYTES, NOT LINES — and this gate read LINES until 2026-08-08, while
// wrap/SKILL.md's Step 1b-DEEP trigger has keyed on BYTES since an OS-level
// OOM crash killed a live /wrap. The SPEC was converted and the ENFORCEMENT LAYER never was,
// so the gate under-fired on exactly the transcripts bytes were introduced for: the two units
// diverge ~10x on a tool-heavy session, where a few enormous records carry the weight.
// Witness — the session that found this: 4,181,599 stripped bytes (FIRES) vs 1,325 lines
// (would NOT have fired at the old >1500 bound). The failure direction is what makes it
// expensive: a session that genuinely skipped 1b-DEEP got `fired=false`, no
// DEEP-PASS-SKIPPED finding, and an EARNED-looking ok:true. Strip base64 exactly as the spec
// does so the two measures cannot drift again: BLANK each base64 payload and keep the line. The spec DELETED
// base64-bearing lines until 2026-09-15, which removed every owner message sent with a screenshot from the
// deep-pass corpus (measured: 9 typed owner records raw, 8 stripped); both copies moved to the blanking form
// in one commit. The Python spec form and this Node form are NOT byte-identical and must never be
// asserted equal: `lines` is `raw.split("\n").filter(Boolean)`, which drops the trailing newline AND every
// blank line, so spec bytes = node bytes + 1 + the interior blank lines (three-arm test).
// The 32.9 MB measurement agreed only because that transcript has no interior blank line.
// Normalise before comparing the two forms.
const strippedBytes = strippedTranscriptBytes(lines);
const deepPassFired = compacted && strippedBytes > 3_000_000;
// The deep-pass dispatch has a UNIQUE signature the spec prose does NOT: the
// anti-stall slice files `wrap-dp-<i>.jsonl` + the `sed -n 'START,ENDp' …jsonl`
// slice-extract command each agent runs. Match ONLY those (NOT the words
// "deep-pass"/"bounded parallel", which the loaded SKILL.md spec says → the
// first-cut false-positive: ran=true when it hadn't).
// FRAGILE BY CONVENTION (2026-07-02): this holds only while the
// spec's worked examples keep the `wrap-dp-<i>` BRACKET form (the `<` is not a word char,
// so `\w` can't match the placeholder). Widened `\d`→`\w` 2026-07-02 after a real
// deep-pass ran but read ran=false: the agents named slices `wrap-dp-sliceA/B` (letter, not
// digit) AND inlined the ~90-char transcript path (pushing `.jsonl` past the 40-char sed
// window) → the digit-only guard missed a genuine run. `\w` detects any reasonable slice
// suffix; a bare (bracket-less) `wrap-dp-<word>` example in wrap/SKILL.md would now false-
// positive, so keep worked examples in the `<...>` form. Block-mode fix-target unchanged:
// derive from <tasksDir>/*.output artifacts instead of a transcript grep.
// ⛔ THE {0,40} WINDOW WAS TOO NARROW FOR THE FILENAME THIS SPEC MANDATES (measured 2026-08-07).
// /wrap 1b-DEEP requires a SESSION-SCOPED corpus (wrap-stripped-<CLAUDE_CODE_SESSION_ID>.jsonl, added
// 2026-08-06 so two concurrent wraps stop overwriting each other's slice source). A session id is 36
// chars, so the real slice command carries 55 chars between the p-quote and .jsonl — past the 40-char
// window. Measured on a wrap that dispatched SEVEN slice agents and was reported SKIPPED. The two fixes
// collided: the one that made the corpus safe blinded the one that proves the pass ran, and the failure
// is directional — the next seat either re-runs a 7-agent wave or learns to ignore the warning.
// Mutation-checked: the real command MISSES at {0,40} and MATCHES at {0,160}. The note below still
// stands — a filename-keyed detector is fragile by construction.
// UNION, never a replacement — the added term can only turn this false→true, so it can
// fix a false NEGATIVE and cannot manufacture a new one. (Replacing the regex outright
// would ship a second blind spot inside the fix for the first.)
// ⛔ The artifact arm read `DEEP_PASS_ARTIFACT_RE.test(raw)` until 2026-09-29 — the whole transcript
// as text, so prose satisfied it (see the comment above DEEP_PASS_ARTIFACT_RE).
// (deepPassRan is defined below the plan block — it is scoped to this wrap.)
// COVERAGE half — see the DEEP-PASS COVERAGE block at module scope for why the planner
// has to state its own slice count and why a union check cannot substitute.
const dpText = dpAssistantText(lines);
// The plan: this wrap's transcript line if it reached the transcript, else this wrap's saved
// slice reports (see THE PLAN'S SECOND SOURCE at module scope).
const dpWrap = dpLastWrap(lines);
const dpWrapMs = dpWrap.ms;
let dpFilePlan = null, dpFileRunMs = NaN, dpReturnsDir = null;
if (sid && Number.isFinite(dpWrapMs)) {
  try {
    const scratch = execSync(`ls -d /private/tmp/claude-*/${PROJECT_KEY}/${sid}/scratchpad 2>/dev/null | head -1`, { encoding: "utf8" }).trim();
    if (scratch && existsSync(scratch)) {
      const tokens = readdirSync(scratch).map((n) => n.match(/^dp-returns-(\d+)$/)).filter(Boolean).map((m) => Number(m[1]));
      const run = dpCurrentReturnsRun(tokens, dpWrapMs);
      if (run != null) {
        dpReturnsDir = `${scratch}/dp-returns-${run}`;
        dpFilePlan = dpReturnsPlan(readdirSync(dpReturnsDir).map((name) => {
          try { return { name, text: readFileSync(`${dpReturnsDir}/${name}`, "utf8") }; } catch { return { name, text: "" }; }
        }));
        dpFileRunMs = run * 1000;
      }
    }
  } catch { dpFilePlan = null; }
}
const dpPlan = dpChoosePlan({ transcript: dpPlanScan(lines), wrapMs: dpWrapMs, file: dpFilePlan, fileRunMs: dpFileRunMs });
const dpPlanned = dpPlan.n;
// null = the ledger could not be read for this session after the plan: BLIND, never 0.
let dpLedger = null;
if (dpPlanned != null && sid && Number.isFinite(dpPlan.ms)) {
  try {
    dpLedger = dpLedgerDispatches(readFileSync(join(REPO_ROOT, DP_LEDGER), "utf8").split("\n"), sid, dpPlan.ms);
  } catch { dpLedger = null; }
}
const dpDispatched = dpLedger ? dpLedger.dispatched : null;
// deepPassRan, SCOPED TO THIS WRAP: the plan side above reads
// only this wrap, so reading the whole transcript here let an earlier wrap's pass stand in for a
// later wrap that ran none, and the result was BLIND instead of SKIPPED. No wrap boundary found ⇒
// the whole transcript, as before. This wrap's slice stubs are also evidence of a run: they are
// written at dispatch, and a one-slice pass (a small window since the last checkpoint) has fewer
// than two dispatches and no orchestrator-side slice artifact.
const deepPassRan = dpRanThisWrap(lines, dpWrap, dpFilePlan);
const dpSlack = dpPlan.source === "file" ? dpUnfiredSlack(dpLinesAt(lines, dpPlan.ms), dpPlan.file) : null;

// ── REPORT (warn-mode). ──
// BLIND paths (2026-07-01): if the tool COULD NOT
// compute a side — no per-agent tasks dir (GC'd/absent → no EMIT count) OR no
// session-start anchor (→ no PERSISTED count, delta=null) — it MUST NOT print ✅.
// The first cut let both fall through the `delta>0` guard to the `else ✅` while
// tasksNote/anchorNote were set-but-never-printed → a false-GREEN-when-blind, the
// EXACT self-certification-when-blind this tool exists to stop (and it no-ops on
// precisely the long multiday sessions this tool targets). Surface BLIND as NOT-a-pass.
const blind = [];
blind.push(...shingleBlind);
if (tasksNote) blind.push("no subagents store and no per-agent tasks dir → EMIT count unavailable");
if (persisted == null) blind.push(anchorNote || "no session-start anchor → PERSISTED count unavailable");
const delta = persisted == null ? null : emitted - persisted;
const findings = [];
const notes = []; // informational; never affects the verdict
// The tmp dirs are a FLOOR (a dir /tmp has cleaned is not seen — the gap the store closes). Every
// agent-dispatching transcript measured has a store (226 of 226), so this is silent today; it speaks when
// a harness stops writing the store and the tmp fallback starts carrying real agent returns.
if (agentReturns.source === "tmp" && emitted + emittedNone + unclassified > 0)
  notes.push(`ℹ️  EMIT SOURCE: no subagents store beside the transcript — the count came from the /tmp task dirs, a floor (a dir /tmp has cleaned is not counted).`);

// ── STEP-ARTIFACT PROBES (2026-07-13) ──────────────────────────────────────
// The three checks above cover memory-delta / deep-pass / post-compact ONLY; every other
// /wrap step was SELF-ATTESTED. That is exactly where the misses cluster, and the split is
// not random: the steps whose output is PROSE (a scan, a surface, a report) get narrated,
// and the steps that RUN A SCRIPT or WRITE A FILE get skipped — because a narrative wrap
// READS complete (every step name appears in the summary) while the artifact was never made.
// Evidence 2026-07-13: the orchestrator self-certified Steps 7d/7e/7h
// done; run for real they returned 22 count-drifts (incl. that session's OWN new hook absent
// from architecture.md), a fired distill cadence and 16 doable-now defer-triggers. The wrap
// did not catch it.
//
// TWO PROBE CLASSES — the distinction is load-bearing:
//   ARTIFACT-bearing (0 / 7d) → the artifact exists on disk or it does not → FINDING.
//   SURFACE-bearing (7e / 7h)      → nothing on disk can prove "I told the owner", so the tool
//                                    COMPUTES AND PRINTS THE SURFACE ITSELF. Never rely on the
//                                    orchestrator remembering to emit it — that IS the bug.
// A probe that CANNOT RUN goes to blind[], never silently passes — a green check must
// never mean "the check didn't run". Warn-mode throughout — exit stays 0.
const shortSid = (sid || "").slice(0, 8);
// Production builds its probe from the SAME factory the self-test consumes (makeProbe). `smoke.skip` is empty
// unless this is a `zzsmoke-` smoke fixture that set WRAP_RECONCILE_SMOKE_SKIP.
const smoke = { skip: smokeSkippedProbes(sid, process.env.WRAP_RECONCILE_SMOKE_SKIP), skipped: [], seen: new Map(), sid };
const probe = makeProbe(blind, smoke);
const sh = (cmd) => execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Step 0 — the `wrapped` lifecycle stamp. It is the peer WAKE signal (a peer blocked on
// `mail-await --peer-done <sid>`) and next-session /orient state — not bookkeeping.
probe("step-0 wrapped-marker", () => {
  if (!shortSid) return null;
  const p = join(REPO_ROOT, ".claude/state", `session-wrapped-${shortSid}`);
  const present = existsSync(p);
  if (!present) findings.push(`⚠️  STEP 0 NOT STAMPED: no .claude/state/session-wrapped-${shortSid}. That marker is the peer WAKE signal (mail-await --peer-done) + next-session /orient state. Run: python3 scripts/session-lifecycle.py wrapped`);
  return present;
});

// Step 7d — architecture doc count/listing drift. MANDATORY when the session added a
// hook / rule / meta lesson: the Tier-1 count fix lands in THIS wrap's commit.
probe("step-7d architecture-counts", () => {
  // CRASH-LAUNDERING (MEASURED): `cmd 2>&1 || true` turns a crashed script into a
  // non-empty node STACK TRACE. That defeats an empty-output guard, parses to zero drift
  // sections, and the probe returns "clean" — certifying a check that never ran.
  // So: read the EXIT CODE, and require a POSITIVE anchor for BOTH verdicts. Never infer clean
  // from an absence.  rc=0 + ✅clean ⇒ clean.  drift sections ⇒ finding.  anything else ⇒ BLIND.
  let out, rc = 0;
  try { out = sh("node scripts/architecture-counts.mjs check"); }
  catch (e) { rc = typeof e.status === "number" ? e.status : -1; out = `${e.stdout || ""}${e.stderr || ""}`; }
  if (!out.trim()) throw new Error("architecture-counts produced no output");
  // ANCHOR on the tool's SECTION HEADERS ("LISTING DRIFTS (2)", "APPENDIX C COVERAGE (1)").
  // The first cut used `!/DRIFT/i.test(out)` and FIRED ON A CLEAN TREE — the clean line itself
  // reads "no drift, no listing gaps", so the unanchored substring matched its own success
  // message: the guard was defeated by the defect family it guards.
  const kinds = driftKinds(out);
  const sawClean = /architecture\.md \+ COMPARISON banner clean/.test(out);
  if (!kinds.length && !sawClean) throw new Error(`architecture-counts exit=${rc} but neither a drift section nor the clean line parsed — output shape changed or it crashed`);
  if (!kinds.length) return true;
  findings.push(`⚠️  STEP 7d UNRUN/UNFIXED: architecture-counts reports ${kinds.join(" · ")}. A session that added a hook/lesson/rule must land the Tier-1 fix (node scripts/architecture-counts.mjs fix) in this wrap's commit. NOTE: do NOT auto-fix drift caused by a PEER's uncommitted work.`);
  return false;
});

// Estimated clock labels in THIS session's working plan (measured on three
// seats). A note, not a finding: a hit can be a retired label the plan
// quotes on purpose, so the operator reads each one before the plan is committed.
probe("plan estimated-clock-labels", () => {
  if (!shortSid) return null;
  const dir = join(REPO_ROOT, "plans");
  const plans = readdirSync(dir).filter((f) => f.startsWith(`session-${shortSid}-`) && f.endsWith(".md"));
  if (!plans.length) return null;
  const hits = plans.flatMap((f) => estimatedClockLabels(readFileSync(join(dir, f), "utf8")).map((h) => `${f}:${h.line} ${h.labels.join(" ")}`));
  const CAP = 12; // a long-running seat's plan carries about 1,450 hit lines (70 KB); uncapped, the whole report spills out of the Bash tool's inline view
  // Future-dated exact stamps: each line against min(blame committer-time, file mtime, transcript write).
  const ahead = plans.flatMap((f) => {
    const rel = join("plans", f), abs = join(dir, f);
    const planLines = readFileSync(abs, "utf8").split("\n");
    const mtime = statSync(abs).mtimeMs;
    const r = spawnSync("git", ["blame", "--line-porcelain", "--", rel], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let written;
    if (r.status === 0) written = blameWriteTimes(r.stdout, mtime);
    else if (/no such path .* in HEAD/.test(r.stderr ?? "")) written = planLines.map(() => mtime); // untracked: every line is uncommitted
    else { blind.push(`plan future-stamps: git blame failed on ${rel} — not measured`); return []; }
    if (written.some((w) => !Number.isFinite(w))) { blind.push(`plan future-stamps: blame of ${rel} has a line with no committer-time — not measured`); return []; }
    const typed = transcriptWriteTimes(lines, f, planLines);
    return futureStampedLines(planLines, written.map((w, i) => (Number.isFinite(typed[i]) ? Math.min(w, typed[i]) : w))).map((h) => `${f}:${h.line} +${h.aheadMin}m`);
  });
  if (ahead.length) notes.push(`⚠️  PLAN STAMPS AHEAD OF THE CLOCK: ${ahead.length} dated line(s) carry a time later than when the line was written — typed from expectation, not read; re-derive each from \`date -u\` or the commit: ${ahead.slice(-12).join(" · ")}`);
  if (hits.length) notes.push(`⚠️  PLAN CLOCK LABELS: ${hits.length} line(s) carry an estimated time (~HH:MM, HH:Mx), not one read off a commit, a mail or \`date -u\` — re-derive each before the plan is committed, or confirm it quotes a retired label: ${hits.slice(-CAP).join(" · ")}${hits.length > CAP ? ` — the last ${CAP} of ${hits.length}; all: \`rg -nP '${ESTIMATED_CLOCK_RE.source}' plans/session-${shortSid}-*.md\`` : ""}`);
  return true;
});

// Step 7e — distill cadence. SURFACE-bearing: the tool prints it so it reaches the owner
// even when the orchestrator forgets. Soft budget / owner-judgment — a note, never a finding.
probe("step-7e distill-cadence", () => {
  // ⛔ BYTES, NOT LINES (2026-08-01). This probe read `wc -l` with a
  // >=4000-line predicate, which was structurally blind: skill MEMORY.md runs
  // 139-318 B/line, so 4000 lines assumes ~65 B/line and fires 3-4x PAST the cliff —
  // measured, 22 of 23 files already truncating on read were INVISIBLE here, and only
  // meta fired, for an unrelated reason. The binding constraint is the Read tool's
  // 25,000-token per-call cap (~57,500 B), not line count. Same number as the two
  // gates: check-memory-budget.sh ARM 2 (write) + warn-large-tracker-read.sh ARM B (read).
  const WARN_BYTES = 46000, CEILING_BYTES = 57500;
  const out = sh("wc -c .claude/skills/*/MEMORY.md 2>/dev/null | grep -v ' total$' || true");
  // A broken glob yields EMPTY -> over=[] -> a silent 0, indistinguishable from "all under budget".
  // wc -c over >=1 real file always prints >=1 line, so empty means the probe did not run.
  if (!out.trim()) throw new Error("wc -c over skills/*/MEMORY.md produced no output — glob broken");
  const sized = out.trim().split("\n").map((l) => l.trim().match(/^(\d+)\s+(\S+)$/)).filter(Boolean)
    .map((m) => ({ bytes: Number(m[1]), skill: m[2].replace(".claude/skills/", "").replace("/MEMORY.md", "") }))
    // meta/MEMORY.md is a cold body store with a separately-governed hot tier
    // (active-recall.md) and its own governor lane (/meta distill) — the
    // same carve-out check-memory-budget.sh ARM 2 makes, for the same reason. Naming
    // it every wrap would train the reader to skip this note.
    .filter((f) => f.skill !== "meta");
  const past = sized.filter((f) => f.bytes >= CEILING_BYTES);
  const near = sized.filter((f) => f.bytes >= WARN_BYTES && f.bytes < CEILING_BYTES);
  // "over the read cap" and "needs splitting" are DIFFERENT PREDICATES, and this line
  // conflated them until 2026-08-06. A skill with a MEMORY-ARCHIVE.md sibling is ALREADY
  // SPLIT: memory-tier-split.mjs refuses it at rc=1, because re-running would parse the
  // index rows as entries and OVERWRITE MEMORY-ARCHIVE.md, destroying every archived body.
  // So the unconditional prescription handed the next reader a DESTRUCTIVE command for
  // exactly the files that have already needed splitting once (their HOT tier regrows).
  // Measured live: a /wrap relayed it for 5 experts; 4 were already split. The companion fix
  // was filed 2026-08-03 and named this exact conditional; its trigger fired on the 2026-08-06 wrap.
  const isSplit = (skill) => existsSync(`.claude/skills/${skill}/MEMORY-ARCHIVE.md`);
  const pastUnsplit = past.filter((f) => !isSplit(f.skill));
  const pastAlreadySplit = past.filter((f) => isSplit(f.skill));
  if (pastUnsplit.length) notes.push(`ℹ️  STEP 7e distill cadence FIRED (≥${CEILING_BYTES} B — past the 25k-token read cap — an unbounded Read is DENIED by warn-large-tracker-read.sh ARM B with paging coordinates, so the cost is a paging round-trip per consult, NOT silent prefix-reading): ${pastUnsplit.map((f) => `${f.skill} (${f.bytes} B)`).join(", ")} — run \`node scripts/memory-tier-split.mjs <skill>\`. Soft budget, owner-judgment, NOT a blocker.`);
  if (pastAlreadySplit.length) notes.push(`⚠️  STEP 7e past the read cap but ALREADY SPLIT — do NOT run memory-tier-split.mjs on these (it refuses at rc=1; forcing it overwrites MEMORY-ARCHIVE.md and destroys every archived body): ${pastAlreadySplit.map((f) => `${f.skill} (${f.bytes} B)`).join(", ")}. Their HOT tier alone is over the cliff — remedy is \`/meta distill <skill>\` or a second-generation split.`);
  if (near.length) notes.push(`ℹ️  STEP 7e approaching the read ceiling (≥${WARN_BYTES} B, under ${CEILING_BYTES}): ${near.map((f) => `${f.skill} (${f.bytes} B)`).join(", ")} — distil when convenient.`);
  return past.length + near.length;
});

// Step 7h — defer-trigger reconcile. SURFACE-bearing, same reasoning as 7e.
probe("step-7h defer-triggers", () => {
  // ⛔ BARE IS CORRECT, AND `--since` IS NOW THE UNDER-REPORT (the time window was retired as a rule; this
  // probe was fixed 2026-08-07, ~8 days after that). HISTORY, kept because it inverted: on 2026-07-29 bare DID skip every
  // `commit-touches` predicate (bare = 6 doable / 44 unevaluated vs flagged = 21 / 0), so the flag was
  // added here to stop a 71%-short reading. No time window applies now —
  // `commit-touches` anchors on the item's own git-blame date, so a fired trigger is STATE and the bare
  // scan sees it. `--since` survives ONLY as a narrowing VIEW (wrap/SKILL.md Step 7h).
  //   Measured 2026-08-07, same tree, same minute:
  //     bare                      -> 50 doable-now · 0 unevaluated · 2 standing-rule reminders
  //     --since "48 hours ago"    -> 41 doable-now · 0 unevaluated · 0 standing-rule reminders
  // BOTH read 0 unevaluated — which is the DISCRIMINATING fact and the reason the old comment is dead:
  // its whole justification was that bare leaves predicates unevaluated, and bare no longer does. The flag
  // was silently dropping 9 items (18%) plus both standing-rule reminders, i.e. the same under-report shape
  // this comment was written to prevent, pointing the other way.
  //   The general form worth keeping: A FLAG ADDED TO FIX AN UNDER-REPORT BECOMES AN UNDER-REPORT ITSELF
  // ONCE THE DEFECT IT COMPENSATED FOR IS FIXED UPSTREAM — and the comment justifying it is what stops
  // anyone re-checking. When a spec records a supersession, grep its CONSUMERS; the spec was corrected
  // 2026-07-30 and this caller kept the retired flag for 8 days with a confident comment defending it.
  // Line 1 is the summary in BOTH forms, so the `(\d+)\s+doable-now` match below is unaffected (verified).
  const out = sh('python3 scripts/defer-trigger-scan.py 2>&1 | head -1 || true');
  const m = out.match(/(\d+)\s+doable-now/);
  // A missing python, a crash, or a REWORDED summary line all land here as "no match". Returning
  // null silently would kill the probe forever with no signal. Blind, never a silent pass.
  if (!m) throw new Error(`defer-trigger-scan line 1 did not match "N doable-now" — crashed or reworded: ${out.trim().slice(0, 60)}`);
  if (m && Number(m[1]) > 0) notes.push(`ℹ️  STEP 7h defer-trigger scan: ${m[1]} doable-now (trigger fired, not yet done) — surface them (\`/triggers\` for the list).`);
  // RECONCILE + STALE were on this SAME captured line all along and were never extracted, so a
  // non-zero reconcile — the one bucket that CLOSES a row — was invisible to /wrap, and surfacing
  // fell back to the orchestrator's self-attested manual step. Added 2026-08-14.
  // These are ADDITIVE: a no-match stays silent
  // rather than throwing, because unlike doable-now they are not this probe's return value, and
  // an older scan build that omits them must not kill the probe.
  const mR = out.match(/(\d+)\s+reconcile/);
  const mS = out.match(/(\d+)\s+stale/);
  if (mR && Number(mR[1]) > 0) notes.push(`⚠️  STEP 7h RECONCILE: ${mR[1]} item(s) whose done-when went TRUE while the box is still [ ] — VERIFY each deliverable yourself, then flip. Never auto-flip (the human-verified path already misfires ~2 in 35).`);
  if (mS && Number(mS[1]) > 0) notes.push(`⚠️  STEP 7h STALE: ${mS[1]} meta: predicate(s) pointing at a missing path or an unrecognized kind — fix the block inline; a stale predicate never fires and reads as coverage.`);
  // ⛔ THE FIFTH MATCH — the SAME class as the fourth, one commit later, caught by the sentence right
  // below it (2026-09-07). That commit routed hot-path commit-touches rows OUT of
  // doable-now into a LATCHED bucket on line 1, and this probe's doable-now figure fell 71 -> 16 with
  // no reader able to say the drop was re-labelling. The datum sat on the captured line the whole
  // time. ADDITIVE like reconcile/stale — an older scan build stays silent here.
  const mL = out.match(/(\d+)\s+latched/);
  if (mL && Number(mL[1]) > 0) notes.push(`ℹ️  STEP 7h LATCHED: ${mL[1]} commit-touches row(s) whose watched path has moved >= LATCH_COMMITS times since the row was filed — NOT in the doable-now count above and NOT newly-unblocked work; each needs RE-KEYING on what it actually waits for (\`/triggers\` lists them hottest-first). A doable-now count that dropped across 2026-09-07 is this re-labelling, not progress.`);
  // ⛔ THE FOURTH MATCH, AND IT EXISTS BECAUSE ITS ABSENCE WAS A REGRESSION I SHIPPED (2026-09-07).
  // That commit routed git-errored predicates out of STALE into their own
  // line-1 bucket on the argument that `head -1` captures line 1 — true, and only half the story:
  // this probe extracts exactly THREE numeric regexes and there was no fourth, so a void run
  // arrived here indistinguishable in kind from a healthy one, differing only in numbers no
  // reader has a baseline for. Worse, moving 79 rows OUT of `stale` DELETED the one warning a
  // broken run used to emit at this consumer — the fix made a void run QUIETER at its own named
  // reader than it was before. **The class: I solved the CAPTURE side and the PARSE
  // side never learned about it.** Check that as a class on the next one.
  //
  // `findings`, not `notes`: a void 7h reading means the whole step returned nothing, which is
  // exactly the self-certification `wrap-reconcile` exists to withhold `ok:true` from. ADDITIVE
  // like the two above — an older scan build that cannot emit the marker leaves this silent.
  const mI = out.match(/(\d+)\s+INSTRUMENT FAILURE/);
  if (mI && Number(mI[1]) > 0) findings.push(`⛔ STEP 7h VOID — NOT clean: ${mI[1]} predicate(s) could not be EVALUATED (a git invocation errored, commonly a \`--since\` value git parsed as a rev). Every bucket that step printed is a VOID reading, so the doable-now / reconcile / stale numbers above it mean nothing. Re-run \`python3 scripts/defer-trigger-scan.py\` BARE — the bare form has been complete for commit-touches since 2026-07-30, so \`--since\` only ever subtracts.`);
  return Number(m[1]);
});
// Accusation base: on the content-matched path the accused set is the POST-shingle residue
// (the hub-relay three-way verdict); on the git-diff fallback path it stays the raw delta.
const accused = (hasTaskOutputs && persisted != null) ? unmatchedHeaders.length : (delta != null && delta > 0 ? delta : 0);
// The inverse the accusation used to lack: slice -> the agent-return file it was captured from.
// `emittedHeaders` and `emittedBlocks` are pushed in the SAME branch, so every accused slice has
// an entry; `(source unknown)` can only mean the fallback path, where there are no blocks at all.
const srcOf = (h) => srcFor(emittedBlocks, h);
if (accused > 0)
  findings.push(`⚠️  MEMORY-UPDATE DELTA: ${emitted} emitted (− ${emittedNone} None) vs ${persisted} persisted exact${likelyRewritten.length ? ` + ${likelyRewritten.length} LIKELY-REWRITTEN (receipts below)` : ""}${echoedInArtifact.length ? ` + ${echoedInArtifact.length} ECHOED-IN-ARTIFACT (counted in the un-persisted figure; receipts below)` : ""} → ${accused} block(s) may be UN-PERSISTED. Unmatched emitted header(s), each with the agent-return file it came from — open THAT file, do not go looking for the slice: ${unmatchedHeaders.map((h) => `«${h}» ← ${srcOf(h)}`).join(" · ") || "(none captured)"}. Enumerate + VERIFY each before acting — exact match is a 40-char VERBATIM-title slice + a 4-word body-shingle pass vs \`git diff <anchor>\` added lines over the durable-home set (memory + rules + DECISIONS.md + todo.txt + docs + AGENTS.md + CLAUDE.md + SKILL specs + the corrections registry + orchestrator + hooks + scripts + plans — widened 2026-08-13 after a 6/6 false-accusation run whose blocks all landed in homes the matcher could not see). Residual false-accusation shapes: (a) a persist whose TITLE and BODY were both fully reworded (no 4-word run survives); (b) a hub-RELAYED block the delegator codifies AFTER this wrap — a future event no matcher can see; cite the outbound mail id; (c) a persist landed outside the widened set. (d) the title matched inside the DISPATCH BRIEF you sent — a brief necessarily quotes the topic the block is titled after, so the hit is your own prose and THERE WAS NO BLOCK; (e) the title matched inside a COMPACTION SUMMARY or a mail body that MENTIONS the block — a mention is not an emission. For (d)/(e): ${residualDeRemedy(agentReturns.dirs, agentReturns.pattern)} A block you VERIFY persisted is a MATCHER miss — cite it, never re-persist (duplicate entry).`);
if (likelyRewritten.length > 0)
  notes.push(`🔎 ${likelyRewritten.length} block(s) LIKELY-REWRITTEN — downgraded WITH receipt, never silently credited: ${likelyRewritten.map((r) => `«${r.header}» ← ${srcOf(r.header)} — ${r.hits}/${r.shingles} shingles in the anchor-diff (e.g. "${r.sample}")`).join(" · ")}. Spot-check a receipt; a wrong one is UN-PERSISTED — treat it as accused.`);
if (echoedInArtifact.length > 0)
  notes.push(`🔎 ${echoedInArtifact.length} block(s) ECHOED-IN-ARTIFACT — the prose matched ADDED lines outside the emitting expert's OWN MEMORY files when the expert is known (a todo row, a meta entry, a review-ledger row, another expert's shard — LENS-OWN CREDIT), or only in plans/, src/, tests/, scripts/, hooks or a locale bundle when it is not (a verdict record quoting the seat's report, a brief quoted in a script comment), so each stays UN-PERSISTED and is inside the delta above (§ HOME CLASS: until 2026-10-10 these were credited LIKELY-REWRITTEN, 43 of 44 falsely on one wrap): ${echoedInArtifact.map((r) => `«${r.header}» ← ${srcOf(r.header)} — ${r.hits}/${r.shingles} shingles ${r.lens ? `outside ${r.lens}'s own memory` : "artifact-class only"} (e.g. "${r.sample}")`).join(" · ")}. The check is a phrase grep over the expert's MEMORY dir; persist what reads 0.`);
// INFORMATIONAL, not a finding. `unclassified` reports the classifier's OWN blind spot; it
// must never flip the verdict, or a reader learns to ignore the tool's warnings. (The
// verdict is computed from `findings` only; `notes` always print.)
if (unclassified > 0)
  notes.push(`ℹ️  ${unclassified} \`### Memory Update\` marker(s) had no dated \`## <date>\`/\`## L#\` heading and were not a "None" skip → UNCLASSIFIED, not counted as emitted. Usually a Monitor/Bash .output quoting this script, or a mail body. Inspect if you expected a real block there.`);
// COVERAGE, not occurrence. Only meaningful once a pass actually ran — a wrap that never
// deep-passed has nothing to under-dispatch, and flagging it would train readers to ignore
// this line. BLIND when the planner emitted no count: the file's own standing rule is that
// a side the tool COULD NOT compute must never print ✅.
if (deepPassRan) {
  if (dpPlanned == null)
    blind.push(
      "deep pass ran but this wrap's plan was found in neither place it can be read from — no slice-count line in REPLY TEXT at or after this wrap began, and no this-wrap `dp-returns-<run>/` folder with slice files in the session scratchpad → COVERAGE unverifiable (state the plan line as reply text, and write the per-slice stubs at dispatch; see .claude/skills/deep-pass/SKILL.md)",
    );
  else if (dpPlan.source === "file" && dpFileIncomplete(dpPlan.file))
    findings.push(
      `⚠️  DEEP-PASS REPORTS INCOMPLETE (read from ${dpReturnsDir}, because no plan line reached the transcript): ` +
        [
          dpPlan.file.pending.length ? `${dpPlan.file.pending.length} of ${dpPlan.file.n} slice file(s) still read \`status: dispatched\`, so those slices never returned (${dpPlan.file.pending.join(", ")})` : "",
          dpPlan.file.gaps && !dpPlan.file.noRange.length ? `${dpPlan.file.gaps} gap(s) between the slice ranges, so those lines were never assigned` : "",
        ].filter(Boolean).join("; ") + ". Re-dispatch or declare the region with real digits.",
    );
  else if (dpSlack && dpSlack.flagged && !dpDeclaredResidue(dpText))
    findings.push(
      `⚠️  DEEP-PASS MAY HAVE MISSED A WAVE (read from ${dpReturnsDir}, because no plan line reached the transcript): the last saved range ends at line ${dpPlan.file.last}, ` +
        `but the transcript had ${dpPlan.file.last + dpSlack.slack} lines when the pass began — ${dpSlack.slack} lines unassigned, more than a median slice (${dpSlack.width}). ` +
        `A wave never dispatched leaves no stub, so this is the only trace it leaves. Dispatch the rest, or declare the region with real digits.`,
    );
  else if (dpDispatched == null)
    blind.push(
      `deep pass stated a plan of ${dpPlanned} slices but the dispatch ledger could not be read for this session after that line → COVERAGE unverifiable (${DP_LEDGER}; needs CLAUDE_CODE_SESSION_ID and a timestamped plan record)`,
    );
  else if (dpDispatched < dpPlanned && dpDeclaredResidue(dpText))
    notes.push(
      `ℹ️  deep-pass partial BY DECLARATION: planned ${dpPlanned} slices, dispatched ${dpDispatched} — and the unread region is ` +
        `named in-transcript, which wrap/SKILL.md treats as a first-class outcome ("partial + honest beats complete + stalled"). Not a finding.`,
    );
  else if (dpDispatched < dpPlanned)
    findings.push(
      `⚠️  DEEP-PASS UNDER-DISPATCHED: planned ${dpPlanned} slices, dispatched ${dpDispatched} distinct slice agent(s) in the dispatch ledger after the plan line${dpLedger.denied ? ` (${dpLedger.denied} more denied by the memory guard — re-dispatch those)` : ""}, and the shortfall is ` +
        `UNDECLARED. Those lines were NEVER SCANNED, and \`ran=true\` says nothing about it. The clamp is a PER-WAVE budget, not a cap on total ` +
        `scope — run the remaining slices as further SEQUENTIAL WAVES (wrap/SKILL.md: a 25-slice transcript is 8-9 waves, "all affordable"). ` +
        `If waves are genuinely unaffordable, declare it as \`line region <first>-<last> unscanned\` with real digits. ` +
        `Silent is the one option that is not on the table: it gets narrated to the owner as "N slices never reported", ` +
        `attributing to the agents what was the orchestrator's own un-fired wave.`,
    );
  if (dpPlan.source === "file")
    notes.push(
      `ℹ️  deep-pass plan read from the ${dpPlan.file.n} saved slice file(s) in ${dpReturnsDir}${dpPlan.file.first != null ? ` (lines ${dpPlan.file.first}-${dpPlan.file.last})` : ""}, because no plan line reached the transcript. ` +
        (dpPlan.file.noRange.length ? `${dpPlan.file.noRange.length} of them carry no parseable \`range:\` line (${dpPlan.file.noRange.join(", ")}), so the span and any gap between ranges are UNVERIFIED. ` : "") +
        `Those files are written per DISPATCH, so a wave that was never dispatched leaves none and is invisible here — check that the last range reaches the transcript's end at the time of the pass.`,
    );
}
const dpSkip = dpSkipVerdict({ fired: deepPassFired, ran: deepPassRan, planned: dpPlanned, declared: dpDeclaredResidue(dpText) });
if (dpSkip === "halted")
  notes.push(`ℹ️  deep-pass HALTED BY DECLARATION: a plan of ${dpPlanned} slices was stated, fewer than two slices were dispatched, and the unread region is named in-transcript — the /deep-pass --sonnet stop's outcome. Not a finding; the owner's answer decides the re-run.`);
else if (dpSkip === "skipped")
  findings.push(`⚠️  DEEP-PASS SKIPPED: ${strippedBytes} stripped transcript bytes > 3000000 + compaction present → Step 1b-DEEP fired, but no parallel deep-pass dispatch detected. Run it (don't rationalize "in-context").`);
// The post-compact marker: an uncleared marker BLOCKS the ✅. Presence is the finding; `focus` only picks the remedy.
if (markerOwed) findings.push(postCompactFinding());   // PRESENCE, not content
else if (markerDeferred) notes.push(`ℹ️  DEFERRED: Claude Code fired its pre-compaction hook (${postCompactPending}) and no compaction has landed — an automatic one fires early, a manual /compact can be refused at the session limit; /post-compact Step 1 deferred it and the marker stands on purpose. Not a finding — it becomes one the moment a compaction boundary lands.`);

// Iron Law #6 leg — notes only, so it can never move the verdict or the exit code (see WRAP_SUBSKILLS).
let subSkills = null;
try { if (sid) subSkills = wrapSubSkillGaps(readFileSync(join(REPO_ROOT, SKILL_LOG), "utf8"), sid); } catch { subSkills = null; }
if (!subSkills) notes.push(`ℹ️  SUB-SKILLS (Iron Law #6): not checked — ${sid ? `${SKILL_LOG} unreadable` : "no CLAUDE_CODE_SESSION_ID"}.`);
else if (subSkills.missing == null) notes.push(`ℹ️  SUB-SKILLS (Iron Law #6): N/A — no non-checkpoint /wrap record for this session in ${SKILL_LOG}, so there is no window to check.`);
else {
  for (const m of subSkills.missing) notes.push(`⚠️  ${m} MISSING (verify the sub-skill's own skip gate) — no ${SKILL_LOG} record for this session at or after the last non-checkpoint /wrap (${subSkills.since}).`);
  notes.push(`ℹ️  SUB-SKILLS (Iron Law #6): ${WRAP_SUBSKILLS.length - subSkills.missing.length} of ${WRAP_SUBSKILLS.length} invoked since ${subSkills.since}. Limits: ${subSkills.unparsed} non-empty log line(s) fail JSON.parse (${subSkills.heads} begin a record, ${subSkills.mine} name this session) and could hold an invocation, so a MISSING may be false; and a legitimate skip leaves the same absence as a skipped step, which this log cannot tell apart.`);
}

// ✅ is EARNED only when BOTH sides were actually computed AND no findings — and a
// LIKELY-REWRITTEN downgrade demotes the accusation WITHOUT greening the top line
// (REVIEW tier — reachable, not theoretical: a hub's review
// block ABOUT a commit shingle-matched the author's own concurrent codification at
// 10 hits / 11.2%). deriveVerdict is module-scope (self-tested).
for (const problem of smokeSkipProblems(smoke.skip, smoke.seen)) blind.push(problem);
const verdict = deriveVerdict(blind.length, findings.length, likelyRewritten.length);
if (asJson) {
  console.log(JSON.stringify({ ok: verdict === "CLEAN", verdict, blind, skipped: smoke.skipped, notes, emitted, emittedNone, unclassified, persisted, persistNote, unmatchedHeaders, likelyRewritten, echoedInArtifact, delta, deepPassFired, deepPassRan, markerPresent, postCompactPending, pendingFocus, postCompactDeferred: markerDeferred, anchorNote, tasksNote, subSkills, findings }));
} else {
  console.log(`wrap-reconcile (warn-mode) — transcript ${nLines} lines`);
  console.log(`  memory-updates: ${emitted} emitted (${emittedNone} None-skips, ${unclassified} unclassified) · ${persisted == null ? "?" : persisted} persisted${persistNote ? ` [${persistNote}]` : ""}${anchorNote ? ` [${anchorNote}]` : ""}`);
  console.log(`  deep-pass: fired=${deepPassFired} ran=${deepPassRan}`);
  console.log(`  post-compact marker: ${markerOwed ? `PENDING (focus=${pendingFocus})` : markerDeferred ? "DEFERRED (hook fired, no compaction landed)" : "cleared"}`);
  console.log(`  step-probes: 0 (wrapped-stamp) · 7d (arch-counts) = artifact-bearing → findings; 7e (distill) · 7h (defer-triggers) · plan clock-labels = surface-bearing → printed above`);
  console.log(`  coverage: COMPUTED = memory-delta + deep-pass + post-compact-marker + the 4 step-probes + the plan clock-label note + the sub-skill invocation check (Iron Law #6, report-only). Every OTHER wrap step is still SELF-ATTESTED (cite its artifact inline; a new mandatory step → add a probe here or list it as UNVERIFIED, same commit)`);
  if (blind.length) { console.log(""); console.log(`  ⚠️  BLIND — could NOT verify completeness (this is NOT a pass): ${blind.join("; ")}. Verify the persists manually before claiming complete.`); }
  if (findings.length) { console.log(""); findings.forEach((f) => console.log("  " + f)); }
  for (const n of notes) console.log(`  ${n}`);
  if (verdict === "CLEAN") console.log("  ✅ no completeness delta detected (both sides computed)");
  if (verdict === "REVIEW") console.log(`  🔎 REVIEW — ${likelyRewritten.length} LIKELY-REWRITTEN downgrade(s) carry receipts above; spot-check them before claiming complete (a downgrade never earns the ✅).`);
}
process.exit(0); // warn-mode: never wedge the wrap
