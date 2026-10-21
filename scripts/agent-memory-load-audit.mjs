#!/usr/bin/env node
/**
 * agent-memory-load-audit — GROUND TRUTH for "did a dispatched sub-agent actually load its own MEMORY.md?"
 *
 * WHAT IT MEASURES
 *   Every sub-agent dispatch leaves two artifacts under
 *     ~/.claude/projects/<encoded-repo>/<session-id>/subagents/
 *       agent-<id>.meta.json   -> carries `agentType` (which skill's MEMORY.md it OWNS)
 *       agent-<id>.jsonl       -> the dispatch transcript (tool_use / tool_result records)
 *   For each dispatch we classify the dispatch's FIRST read of ITS OWN
 *   `.claude/skills/<agentType>/MEMORY.md`:
 *       OK             read whole, uncapped, complete
 *       TRUNCATED      read "succeeded" but delivered a PARTIAL view (see SILENT CLASS below)
 *       BYTE           hard error: "File content (N KB) exceeds maximum allowed size (256KB)"
 *       TOKEN          hard error: "File content (N tokens) exceeds maximum allowed tokens (25000)"
 *       ERROR_OTHER    the read errored for some other reason
 *       NO_RESULT      a Read was issued and no tool_result was ever recorded (dispatch cut short)
 *       NO_ATTEMPT     a MEMORY.md exists on disk for this agentType and was never opened
 *       ALT_READ       no Read of the router, but the memory FAMILY (MEMORY*.md) was touched via
 *                      a Bash command, a shard Read, or a Grep at the family path — the two
 *                      NO_ATTEMPT-inflating blind channels measured 2026-08-25/26. A CEILING:
 *                      a Bash command can mention without reading; corrected NO_ATTEMPT is a FLOOR.
 *                      SPLIT (measured: 69.3% of ALT commands capped):
 *                      altVia "bash" = an UNCAPPED whole-file command seen; "bash-capped" = only
 *                      head/tail/sed -n/cut-bounded reads — page-1 delivery the primer forbids,
 *                      a DEGRADED sibling in everything but name; "shard" / "grep" as before.
 *       ERROR_OTHER    is GUARD 1 denying an unbounded Read; recovery IS computed for it (measured:
 *                      68.1% paged recovery there vs 12.7% on the byte cap — the guard is not inert).
 *       NO_MEMORY_FILE this agentType has no MEMORY.md at all (not a finding)
 *   plus `recovered` — a LATER offset/limit read of the same path that did not error.
 *
 * ⛔ THE SILENT CLASS — `is_error` IS ABSENT AND THE CONTENT IS WELL-FORMED.
 *   A whole-file Read of a MEMORY.md over the 25,000-token cap does NOT hard-error in the current
 *   harness. It returns a normal, well-formed tool_result carrying the first page, and discloses
 *   the loss only in a SEPARATE sibling record:
 *       {"type":"attachment","attachment":{"type":"read_truncation_notice",
 *         "banner":"[Truncated: PARTIAL view — <path>: showing lines 1-231 of 859 total
 *                   (78963 tokens, cap 25000). Call Read with offset=232 ...]",
 *         "toolUseID":"toolu_..."}}
 *   Measured 2026-08-01: 638 of 1,643 apparently-successful first reads (38.8%) were this. A
 *   classifier that reads only `is_error` reports every one of them as a clean load — fail-open on
 *   precisely the class GUARD 1 exists to close. We correlate the attachment by `toolUseID`.
 *
 * ⚠️ DIVERGENCE FROM THE EARLIER BASELINE, AND WHY (do not "fix" this back).
 *   An earlier review (2026-08-01) reported TOKEN = 127 dispatches. This script reports TOKEN = 0 on the
 *   FIRST-read axis and 133 on the ANY-READ axis, and the two are the same underlying events:
 *   a hard token cap never fires on a first whole-file read (that path truncates silently) — it
 *   fires on a LATER paged read whose own slice exceeds 25k tokens. That review's OK count (1,514)
 *   correspondingly lumps the silent-truncation cohort in with clean loads. Both axes are printed.
 *
 * ⛔ THE LOAD-BEARING IMPLEMENTATION CONSTRAINT — CORRELATE BY `tool_use_id`, NEVER BY LINE.
 *   Both cap errors are emitted with NO FILE PATH in the message text:
 *       "File content (365.3KB) exceeds maximum allowed size (256KB). Use offset and limit ..."
 *       "File content (29160 tokens) exceeds maximum allowed tokens (25000). Use offset and limit ..."
 *   So the natural probe — grep a line for (error string AND path) — matches only the rare case where
 *   both happen to land in one record, and is blind to ~98% of incidents. Measured:
 *   a same-line probe returned 7 incidents where the tool_use_id-correlated probe returned 356 (51x
 *   under-count). `--self-test` carries that exact discriminating fixture (interleaved-BYTE) and
 *   prints the naive probe's wrong answer beside the correlated one.
 *
 * MODES (bare invocation exits NON-ZERO with usage: a helpful exit-0 makes every
 * gate above this script false-green)
 *   --session <sid|8-hex-prefix>   one session (fast, free at /expert-review synthesis time)
 *   --fleet                        every session in the project (~2.9 GB, minutes)
 *   --self-test                    synthetic fixture corpus through the SAME scan function
 *   --json                         machine-readable output (composes with --session/--fleet)
 *
 * Enforcement home: /expert-review synthesis + /wrap. NOT CI — no transcripts exist there.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";
import { projectKey, projectKeyDir, repoRoot as mainRepoRoot } from "./lib/project-key.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** Verdict tokens — a composing gate must require one of these, never rc==0 alone. */
const VERDICT_OK = "VERDICT: AUDIT-COMPLETE";
const VERDICT_SELF_TEST_PASS = "VERDICT: SELF-TEST-PASS";
const VERDICT_SELF_TEST_FAIL = "VERDICT: SELF-TEST-FAIL";

/**
 * Cap-error signatures. Anchored on the stable half of each message.
 * These are matched against the tool_result CONTENT of a read we already know (by tool_use_id)
 * targeted the MEMORY.md path — the text itself can never tell us which file it was.
 */
const BYTE_CAP_RE = /exceeds maximum allowed size/i;
const TOKEN_CAP_RE = /exceeds maximum allowed tokens/i;

const CLASSES = ["OK", "TRUNCATED", "BYTE", "TOKEN", "ERROR_OTHER", "NO_RESULT", "ALT_READ", "NO_ATTEMPT", "NO_MEMORY_FILE"];

/** Classes in which the dispatch did NOT get its whole memory. */
const DEGRADED = new Set(["TRUNCATED", "BYTE", "TOKEN"]);

// ---------------------------------------------------------------------------
// Core scan (exported — `--self-test` asserts through THIS function, never an inline regex)
// ---------------------------------------------------------------------------

/** Encode a repo path the way Claude Code names its projects dir — the repo's ONE port of it,
 *  `scripts/lib/project-key.mjs` (per UTF-16 unit, so /a/b.c -> -a-b-c and a non-BMP character
 *  is two dashes; over 200 units the harness's `-` + base36(|hash|) suffix). Kept under this
 *  name for its callers. */
export function encodeProjectDir(repoRoot) {
  return projectKey(repoRoot);
}

/** `~/.claude/projects/<key>` — by default for the MAIN checkout holding this script (a linked
 *  worktree resolves to it, as the harness keys it), or for an explicit root (`--repo-root`). */
export function defaultProjectsDir(repoRoot = mainRepoRoot(REPO_ROOT)) {
  return projectKeyDir(repoRoot);
}

/** Resolve the MEMORY.md an agentType owns. Returns null when the agentType is not a skill. */
export function memoryPathFor(repoRoot, agentType) {
  if (!agentType || /[\\/]/.test(agentType)) return null;
  return path.join(repoRoot, ".claude", "skills", agentType, "MEMORY.md");
}

/**
 * Classify ONE dispatch from its transcript text.
 *
 * @param {string} jsonlText  raw agent-<id>.jsonl contents
 * @param {string} memPath    absolute path of the MEMORY.md this dispatch owns
 * @returns {{cls:string, recovered:boolean, attempts:number, capDetail:string|null, anyCap:{byte:boolean,token:boolean,truncated:boolean}}}
 */
export function classifyDispatch(jsonlText, memPath) {
  const NONE = { byte: false, token: false, truncated: false };
  // FAMILY token: ".claude/skills/<type>/MEMORY" — matches the router AND the MEMORY-ARCHIVE-*
  // shards, in absolute OR relative spelling. The absolute-only fast reject was blind channel (1):
  // an agent running a relative-path Bash read (the auto-mode default) never writes the absolute
  // memPath into its transcript, so it scored NO_ATTEMPT while genuinely reading the file.
  const relFamily = memPath.replace(/^[\s\S]*?(\.claude[\\/]skills[\\/])/, "$1").replace(/\.md$/, "");
  // The ROUTER at any prefix: a worktree-isolated agent reads
  // .../worktrees/agent-XXXX/.claude/skills/<type>/MEMORY.md — not memPath byte-for-byte, but the
  // router all the same. Matching memPath exactly pushed those reads out of PASS 1 into the ALT
  // scan, where the family substring labelled them "shard" (all three
  // fleet "shard reads" were worktree ROUTER reads; a truncated one was hidden inside ALT).
  const relRouter = relFamily + ".md";
  const isRouterPath = (fp) => typeof fp === "string" && (fp === memPath || fp.endsWith("/" + relRouter) || fp.endsWith("\\" + relRouter));
  // Fast reject: if the memory FAMILY never appears in the transcript at all, no read was attempted.
  // (Paths are stored unescaped in the JSON, so a plain substring test is exact.)
  if (jsonlText.indexOf(relFamily) === -1) {
    return { cls: "NO_ATTEMPT", recovered: false, attempts: 0, capDetail: null, anyCap: { ...NONE } };
  }

  const lines = jsonlText.split("\n");

  // PASS 1 — collect the tool_use ids of Read calls on THIS memPath, in transcript order.
  /** @type {{id:string, paged:boolean}[]} */
  const attempts = [];
  const wanted = new Set();
  for (const line of lines) {
    if (!line || line.indexOf(relRouter) === -1) continue; // relative: the router at ANY prefix (worktree agents)
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || block?.name !== "Read") continue;
      const fp = block?.input?.file_path;
      if (!isRouterPath(fp)) continue;
      const paged = block.input.offset != null || block.input.limit != null;
      attempts.push({ id: block.id, paged });
      wanted.add(block.id);
    }
  }

  if (attempts.length === 0) {
    // No Read targeted the router. Before scoring NO_ATTEMPT, scan for the ALT channels a
    // 2026-08-25 measurement confirmed the old classifier was blind to — each one inflating NO_ATTEMPT:
    //   (shard) a Read of any MEMORY family path that is not the router — the CORRECT read for the
    //           sharded skills, whose MEMORY.md is a regenerated router;
    //   (bash)  a Bash command touching the family (cat / sed -n / grep of MEMORY*.md);
    //   (grep)  a Grep whose path is the family.
    // A PROSE mention (a text block naming the path) matches none of these — only tool_use blocks
    // count, so mention-vs-use is preserved; the self-test carries the negative control.
    let altVia = null;
    for (const line of lines) {
      if (!line || line.indexOf(relFamily) === -1) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const content = rec?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== "tool_use") continue;
        if (block.name === "Read" && typeof block.input?.file_path === "string" && block.input.file_path.indexOf(relFamily + "-ARCHIVE") !== -1) {
          altVia = "shard"; // an archive shard — router reads at any prefix were caught in PASS 1
        } else if (block.name === "Bash" && typeof block.input?.command === "string" && block.input.command.indexOf(relFamily) !== -1) {
          // Capped = page-1 delivery (head/tail/sed -n/cut/wc bounded). An uncapped whole-file
          // command anywhere in the transcript wins over capped ones seen elsewhere.
          const capped = /(^|[\s|;&])(head|tail)\b|sed\s+-n\b|\bcut\s+-c|--max-count|(^|[\s|;&])wc\b/.test(block.input.command);
          if (!capped) altVia = altVia === "shard" ? altVia : "bash";
          else if (altVia == null || altVia === "bash-capped") altVia = "bash-capped";
        } else if (block.name === "Grep" && typeof block.input?.path === "string" && block.input.path.indexOf(relFamily) !== -1) {
          altVia = altVia ?? "grep";
        }
        if (altVia === "shard") break;
      }
      if (altVia === "shard") break;
    }
    if (altVia) {
      return { cls: "ALT_READ", recovered: false, attempts: 0, capDetail: null, anyCap: { ...NONE }, altVia };
    }
    return { cls: "NO_ATTEMPT", recovered: false, attempts: 0, capDetail: null, anyCap: { ...NONE } };
  }

  // PASS 2 — correlate results BY tool_use_id. This is the whole point of the script:
  // the cap-error text carries no path, so nothing else can attribute an error to a file.
  // Truncation notices arrive as SEPARATE `attachment` records keyed by `toolUseID` — a result
  // read alone cannot see them, which is what makes the silent class silent.
  /** @type {Map<string,{isError:boolean, text:string}>} */
  const results = new Map();
  /** @type {Map<string,string>} toolUseID -> truncation banner */
  const truncated = new Map();
  for (const line of lines) {
    if (!line) continue;
    let hit = false;
    for (const id of wanted) {
      if (line.indexOf(id) !== -1) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type === "attachment" && rec?.attachment?.type === "read_truncation_notice") {
      const tid = rec.attachment.toolUseID;
      if (wanted.has(tid) && !truncated.has(tid)) truncated.set(tid, rec.attachment.banner ?? "");
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      if (!wanted.has(block.tool_use_id)) continue;
      const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
      if (!results.has(block.tool_use_id)) {
        results.set(block.tool_use_id, { isError: block.is_error === true, text });
      }
    }
  }

  // ANY-READ axis — kept alongside the first-read axis because the two answer different questions
  // and the earlier baseline was measured on this one. See the DIVERGENCE note in the header.
  const anyCap = { ...NONE };
  for (const a of attempts) {
    const r = results.get(a.id);
    if (r?.isError) {
      if (BYTE_CAP_RE.test(r.text)) anyCap.byte = true;
      else if (TOKEN_CAP_RE.test(r.text)) anyCap.token = true;
    } else if (truncated.has(a.id)) {
      anyCap.truncated = true;
    }
  }

  const first = results.get(attempts[0].id);
  let cls;
  let capDetail = null;
  if (!first) {
    // FAIL-CLOSED. An unrecorded result is UNKNOWN, never "fine" — treating it as OK is the same
    // fail-open shape as ignoring the truncation attachment.
    cls = "NO_RESULT";
  } else if (first.isError) {
    capDetail = (first.text.match(/File content \(([^)]+)\)/) || [])[1] ?? null;
    if (BYTE_CAP_RE.test(first.text)) cls = "BYTE";
    else if (TOKEN_CAP_RE.test(first.text)) cls = "TOKEN";
    else {
      cls = "ERROR_OTHER";
      capDetail = null;
    }
  } else if (truncated.has(attempts[0].id)) {
    cls = "TRUNCATED";
    const b = truncated.get(attempts[0].id) ?? "";
    capDetail = (b.match(/showing lines ([\d-]+ of \d+ total \([^)]*\))/) || [])[1] ?? null;
  } else {
    cls = "OK";
  }

  // Recovery = a LATER paged (offset/limit) attempt on the same path that did not error.
  // A paged retry that itself errors is not a recovery; a paged retry that is itself truncated
  // still counts (content WAS delivered — the agent is paging, which is the behaviour we measure).
  let recovered = false;
  // ERROR_OTHER is the unbounded-Read GUARD deny; a paged retry after it is exactly the recovery
  // the guard prescribes, so it is measured here too (it was never recorded).
  if (DEGRADED.has(cls) || cls === "ERROR_OTHER") {
    for (let i = 1; i < attempts.length; i++) {
      const r = results.get(attempts[i].id);
      if (attempts[i].paged && r && !r.isError) {
        recovered = true;
        break;
      }
    }
  }

  return { cls, recovered, attempts: attempts.length, capDetail, anyCap };
}

/**
 * Scan a corpus of session dirs.
 *
 * @param {object} opts
 * @param {string} opts.projectsDir  dir holding <session-id>/subagents/
 * @param {string} opts.repoRoot     repo whose .claude/skills/<type>/MEMORY.md we resolve against
 * @param {string[]} [opts.sessions] explicit session ids (default: every dir with a subagents/)
 * @param {(msg:string)=>void} [opts.onProgress]
 */
export function scanCorpus({ projectsDir, repoRoot, sessions, onProgress }) {
  const sessionIds =
    sessions ??
    (fs.existsSync(projectsDir)
      ? fs
          .readdirSync(projectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && fs.existsSync(path.join(projectsDir, d.name, "subagents")))
          .map((d) => d.name)
      : []);

  const memExistsCache = new Map();
  const memExists = (agentType) => {
    if (memExistsCache.has(agentType)) return memExistsCache.get(agentType);
    const p = memoryPathFor(repoRoot, agentType);
    const ok = p != null && fs.existsSync(p);
    memExistsCache.set(agentType, ok);
    return ok;
  };

  const EMPTY_CAP = { byte: false, token: false, truncated: false };
  /** @type {{sessionId:string, agentId:string, agentType:string, cls:string, recovered:boolean, attempts:number, capDetail:string|null, anyCap:object}[]} */
  const rows = [];
  let metaFound = 0;
  let metaUnparsable = 0;
  let jsonlMissing = 0;
  let bytesRead = 0;
  let sessionsScanned = 0;

  for (const sid of sessionIds) {
    const subDir = path.join(projectsDir, sid, "subagents");
    let entries;
    try {
      entries = fs.readdirSync(subDir);
    } catch {
      continue;
    }
    sessionsScanned++;
    for (const name of entries) {
      if (!name.endsWith(".meta.json")) continue;
      metaFound++;
      const agentId = name.slice("agent-".length, -".meta.json".length);
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(subDir, name), "utf8"));
      } catch {
        metaUnparsable++;
        continue;
      }
      const agentType = meta?.agentType ?? "(unknown)";
      const memPath = memoryPathFor(repoRoot, agentType);

      if (!memPath || !memExists(agentType)) {
        rows.push({ sessionId: sid, agentId, agentType, cls: "NO_MEMORY_FILE", recovered: false, attempts: 0, capDetail: null, anyCap: { ...EMPTY_CAP } });
        continue;
      }

      const jsonlPath = path.join(subDir, `agent-${agentId}.jsonl`);
      let text;
      try {
        const st = fs.statSync(jsonlPath);
        bytesRead += st.size;
        text = fs.readFileSync(jsonlPath, "utf8");
      } catch {
        jsonlMissing++;
        rows.push({ sessionId: sid, agentId, agentType, cls: "NO_ATTEMPT", recovered: false, attempts: 0, capDetail: null, anyCap: { ...EMPTY_CAP } });
        continue;
      }

      const r = classifyDispatch(text, memPath);
      rows.push({ sessionId: sid, agentId, agentType, ...r });
    }
    if (onProgress && sessionsScanned % 10 === 0) {
      onProgress(`  … ${sessionsScanned}/${sessionIds.length} sessions · ${metaFound} dispatches`);
    }
  }

  return {
    rows,
    corpus: {
      sessionsAvailable: sessionIds.length,
      sessionsScanned,
      metaFound,
      metaUnparsable,
      jsonlMissing,
      dispatchesClassified: rows.length,
      transcriptBytesRead: bytesRead,
      skillMemoryFilesOnDisk: countSkillMemories(repoRoot),
    },
  };
}

function countSkillMemories(repoRoot) {
  const skills = path.join(repoRoot, ".claude", "skills");
  if (!fs.existsSync(skills)) return 0;
  return fs
    .readdirSync(skills, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skills, d.name, "MEMORY.md"))).length;
}

/**
 * The NAIVE probe measured under-counting 51x. Kept ONLY so --self-test can print it
 * beside the correlated answer — never used for a real measurement.
 */
export function naiveSameLineProbe(jsonlText, memPath) {
  let n = 0;
  for (const line of jsonlText.split("\n")) {
    if (!line) continue;
    if (line.indexOf(memPath) !== -1 && (BYTE_CAP_RE.test(line) || TOKEN_CAP_RE.test(line))) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(rows) {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const degraded = rows.filter((r) => DEGRADED.has(r.cls));
  const perType = new Map();
  for (const r of rows) {
    byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
    const t = perType.get(r.agentType) ?? { agentType: r.agentType, total: 0, degraded: 0, blind: 0, noAttempt: 0 };
    t.total++;
    if (DEGRADED.has(r.cls)) {
      t.degraded++;
      if (!r.recovered) t.blind++;
    }
    if (r.cls === "NO_ATTEMPT") t.noAttempt++;
    perType.set(r.agentType, t);
  }
  const rec = (cls) => {
    const set = rows.filter((r) => r.cls === cls);
    const r = set.filter((x) => x.recovered).length;
    return { n: set.length, recovered: r, blind: set.length - r };
  };
  return {
    byClass,
    total: rows.length,
    degraded: { n: degraded.length, recovered: degraded.filter((r) => r.recovered).length, blind: degraded.filter((r) => !r.recovered).length },
    truncatedClass: rec("TRUNCATED"),
    byteClass: rec("BYTE"),
    tokenClass: rec("TOKEN"),
    errorOtherClass: rec("ERROR_OTHER"),
    // ANY-READ axis — the earlier baseline was measured here; see the header DIVERGENCE note.
    anyRead: {
      byte: rows.filter((r) => r.anyCap?.byte).length,
      token: rows.filter((r) => r.anyCap?.token).length,
      truncated: rows.filter((r) => r.anyCap?.truncated).length,
      any: rows.filter((r) => r.anyCap && (r.anyCap.byte || r.anyCap.token || r.anyCap.truncated)).length,
    },
    altRead: {
      n: rows.filter((r) => r.cls === "ALT_READ").length,
      bash: rows.filter((r) => r.altVia === "bash").length,
      bashCapped: rows.filter((r) => r.altVia === "bash-capped").length,
      shard: rows.filter((r) => r.altVia === "shard").length,
      grep: rows.filter((r) => r.altVia === "grep").length,
    },
    perType: [...perType.values()],
  };
}

const pct = (n, d) => (d === 0 ? "  0.0%" : `${((n / d) * 100).toFixed(1)}%`.padStart(6));
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function printReport(mode, { rows, corpus }) {
  const s = summarize(rows);
  const out = [];
  out.push(`agent-memory-load-audit — mode: ${mode}`);
  // CORPUS SIZE NEXT TO THE VERDICT: a sweep that silently scans only part of its corpus still
  // shows a green positive control. The file count is the only discriminator.
  out.push(
    `corpus: ${corpus.sessionsScanned}/${corpus.sessionsAvailable} sessions scanned · ` +
      `${corpus.metaFound} meta files found · ${corpus.dispatchesClassified} dispatches classified · ` +
      `${mb(corpus.transcriptBytesRead)} transcript read · ${corpus.skillMemoryFilesOnDisk} skill MEMORY.md on disk`,
  );
  if (corpus.metaUnparsable || corpus.jsonlMissing) {
    out.push(`  (meta unparsable: ${corpus.metaUnparsable} · jsonl missing: ${corpus.jsonlMissing})`);
  }
  out.push("");
  out.push("  own-MEMORY read outcome                        n       %");
  const label = {
    OK: "OK  (whole file, complete)",
    TRUNCATED: "TRUNCATED  (SILENT partial — no error raised)",
    BYTE: "BYTE  cap  (>256 KB, hard error)",
    TOKEN: "TOKEN cap  (>25,000 tokens, hard error)",
    ERROR_OTHER: "ERROR_OTHER",
    NO_RESULT: "NO_RESULT  (read issued, no result recorded)",
    ALT_READ: "ALT_READ  (family read via bash/shard/grep)",
    NO_ATTEMPT: "NO_ATTEMPT  (MEMORY.md on disk, never opened)",
    NO_MEMORY_FILE: "n/a  (agentType has no MEMORY.md)",
  };
  for (const c of CLASSES) {
    out.push(`  ${label[c].padEnd(44)} ${String(s.byClass[c]).padStart(5)}  ${pct(s.byClass[c], s.total)}`);
  }
  out.push(`  ${"TOTAL".padEnd(44)} ${String(s.total).padStart(5)}`);
  if (s.altRead.n) {
    out.push(
      `    ALT_READ split: bash-FULL ${s.altRead.bash} · bash-CAPPED ${s.altRead.bashCapped} (page-1 reads — partial, primer-forbidden) · ` +
        `shard ${s.altRead.shard} · grep ${s.altRead.grep} — the mention class is a CEILING; capped is a DEGRADED sibling`,
    );
  }
  out.push("");
  const withMem = s.total - s.byClass.NO_MEMORY_FILE;
  out.push(
    `  DEGRADED first load (TRUNCATED+BYTE+TOKEN): ${s.degraded.n} of ${withMem} dispatches that own a MEMORY.md ` +
      `(${withMem ? ((s.degraded.n / withMem) * 100).toFixed(1) : "0.0"}%)`,
  );
  out.push(
    `    recovered (paged afterwards): ${s.degraded.recovered} ` +
      `(${s.degraded.n ? ((s.degraded.recovered / s.degraded.n) * 100).toFixed(1) : "0.0"}%) · ran blind: ${s.degraded.blind}`,
  );
  for (const [name, c] of [["TRUNCATED", s.truncatedClass], ["BYTE     ", s.byteClass], ["TOKEN    ", s.tokenClass], ["GUARD-DENY (ERROR_OTHER)", s.errorOtherClass]]) {
    out.push(
      `    ${name}: ${String(c.n).padStart(4)} · ${String(c.recovered).padStart(3)} recovered · ${String(c.blind).padStart(4)} blind ` +
        `(${c.n ? ((c.blind / c.n) * 100).toFixed(1) : "0.0"}% ran blind)`,
    );
  }
  out.push("");
  // Second axis: the earlier baseline was measured here. Printed so the two reconcile in public.
  out.push(
    `  ANY-READ axis (a cap at any read position, not just the first) — BYTE ${s.anyRead.byte} · ` +
      `TOKEN ${s.anyRead.token} · TRUNCATED ${s.anyRead.truncated} · any ${s.anyRead.any}`,
  );
  out.push("");
  const topCapped = s.perType.filter((t) => t.degraded > 0).sort((a, b) => b.degraded - a.degraded).slice(0, 6);
  const topNoAttempt = s.perType.filter((t) => t.noAttempt > 0).sort((a, b) => b.noAttempt - a.noAttempt).slice(0, 6);
  if (topCapped.length) {
    out.push(`  top degraded agentTypes: ${topCapped.map((t) => `${t.agentType} ${t.degraded} (${t.blind} blind)`).join(" · ")}`);
  }
  if (topNoAttempt.length) {
    out.push(`  top NO_ATTEMPT agentTypes: ${topNoAttempt.map((t) => `${t.agentType} ${t.noAttempt}`).join(" · ")}`);
  }
  out.push("");
  out.push(VERDICT_OK);
  console.log(out.join("\n"));
}

// ---------------------------------------------------------------------------
// Self-test — synthetic corpus through the SAME scanCorpus() the real run uses
// ---------------------------------------------------------------------------

function jline(obj) {
  return JSON.stringify(obj);
}
function toolUse(id, filePath, extra = {}) {
  return jline({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: filePath, ...extra } }] } });
}
function toolResult(id, content, isError = false) {
  return jline({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
}
/** The SILENT class: a sibling `attachment` record — no is_error anywhere, content well-formed. */
function truncationNotice(id, filePath, shown, total, tokens) {
  return jline({
    type: "attachment",
    attachment: {
      type: "read_truncation_notice",
      banner: `[Truncated: PARTIAL view — ${filePath}: showing lines 1-${shown} of ${total} total (${tokens} tokens, cap 25000). Call Read with offset=${shown + 1} limit=${shown} for the next page, or Grep to find a specific section. Do NOT answer from this page alone if the answer may be further in the file.]`,
      toolUseID: id,
    },
  });
}
const BYTE_ERR = "File content (395.1KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.";
const TOKEN_ERR = "File content (29160 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.";
const NOISE = [
  toolUse("toolu_noise1", "/tmp/whatever/SKILL.md"),
  toolResult("toolu_noise1", "1\t# skill\n"),
  jline({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "thinking about the corpus" }] } }),
  toolUse("toolu_noise2", "/tmp/whatever/other.md"),
  toolResult("toolu_noise2", "1\t# other\n"),
  jline({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "still working" }] } }),
];

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memload-selftest-"));
  const repo = path.join(root, "repo");
  const projects = path.join(root, "projects");
  const sess = path.join(projects, "sess-selftest", "subagents");
  fs.mkdirSync(sess, { recursive: true });

  const withMemory = ["fixture-ok", "fixture-trunc", "fixture-byte", "fixture-token", "fixture-noattempt", "fixture-decoy", "fixture-noresult", "fixture-altbash", "fixture-altshard", "fixture-mention", "fixture-altcapped", "fixture-wtrouter"];
  for (const t of [...withMemory, "fixture-nomem"]) {
    fs.mkdirSync(path.join(repo, ".claude", "skills", t), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "skills", t, "SKILL.md"), "# skill\n");
  }
  for (const t of withMemory) {
    fs.writeFileSync(path.join(repo, ".claude", "skills", t, "MEMORY.md"), "# memory\n");
  }
  const mem = (t) => path.join(repo, ".claude", "skills", t, "MEMORY.md");

  const write = (agentId, agentType, lines) => {
    fs.writeFileSync(path.join(sess, `agent-${agentId}.meta.json`), JSON.stringify({ agentType, description: "fixture", toolUseId: `toolu_parent_${agentId}`, spawnDepth: 1, model: "fable" }));
    fs.writeFileSync(path.join(sess, `agent-${agentId}.jsonl`), lines.join("\n") + "\n");
  };

  // 1. OK — read whole, uncapped.
  write("fx01ok", "fixture-ok", [toolUse("toolu_ok1", mem("fixture-ok")), toolResult("toolu_ok1", "1\t# memory\n2\tentries...\n")]);

  // 2. BYTE, never paged — AND the tool_result is separated from its tool_use by 6 unrelated
  //    records. This is the discriminating fixture: the error text carries no path, so a same-line
  //    (path AND error-string) probe scores ZERO here while the correlated scan scores one.
  write("fx02byte", "fixture-byte", [toolUse("toolu_byte1", mem("fixture-byte")), ...NOISE, toolResult("toolu_byte1", BYTE_ERR, true), jline({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "proceeding without memory" }] } })]);

  // 3. TOKEN cap, then a paged read that succeeds -> recovered.
  write("fx03token", "fixture-token", [toolUse("toolu_tok1", mem("fixture-token")), toolResult("toolu_tok1", TOKEN_ERR, true), toolUse("toolu_tok2", mem("fixture-token"), { offset: 1600, limit: 300 }), toolResult("toolu_tok2", "1600\t## 2026-07-30 ...\n")]);

  // 4. NO_ATTEMPT — MEMORY.md on disk, dispatch reads only its SKILL.md.
  write("fx04noattempt", "fixture-noattempt", [toolUse("toolu_na1", path.join(repo, ".claude", "skills", "fixture-noattempt", "SKILL.md")), toolResult("toolu_na1", "1\t# skill\n")]);

  // 5. RED CONTROL (decoy) — this dispatch reads its OWN memory successfully AND separately
  //    byte-errors on an UNRELATED file. A path-blind / any-error-in-transcript probe reports BYTE.
  //    The correct answer is OK. If this ever returns BYTE, the classifier has stopped correlating.
  write("fx05decoy", "fixture-decoy", [toolUse("toolu_dec1", mem("fixture-decoy")), toolResult("toolu_dec1", "1\t# memory\n"), toolUse("toolu_dec2", "/tmp/whatever/huge-unrelated-corpus.md"), toolResult("toolu_dec2", BYTE_ERR, true)]);

  // 6. NO_MEMORY_FILE — agentType with no MEMORY.md on disk.
  write("fx06nomem", "fixture-nomem", [toolUse("toolu_nm1", path.join(repo, ".claude", "skills", "fixture-nomem", "SKILL.md")), toolResult("toolu_nm1", "1\t# skill\n")]);

  // 7. RED CONTROL (silent truncation) — the read "succeeds": is_error is FALSE and the content is
  //    well-formed. The loss is disclosed only by the sibling attachment record, which is separated
  //    from its tool_use by the same noise block. A classifier that reads only `is_error` calls this
  //    OK — fail-open on the largest measured cohort (638 fleet dispatches). Must classify TRUNCATED.
  write("fx07trunc", "fixture-trunc", [
    toolUse("toolu_tr1", mem("fixture-trunc")),
    ...NOISE,
    toolResult("toolu_tr1", "1\t# memory\n2\tfirst page only...\n"),
    truncationNotice("toolu_tr1", mem("fixture-trunc"), 231, 859, 78963),
  ]);

  // 8. NO_RESULT — a Read was issued and the dispatch ended before any result was recorded.
  //    Must NOT be OK: an unrecorded outcome is UNKNOWN, and calling it clean is the same
  //    fail-open shape as ignoring the truncation attachment.
  write("fx08noresult", "fixture-noresult", [toolUse("toolu_nr1", mem("fixture-noresult"))]);

  // 9. ALT (bash) — blind channel 1: the memory read happens through a RELATIVE-path Bash cat,
  //    the auto-mode default. The absolute-path classifier scored exactly this NO_ATTEMPT.
  write("fx09altbash", "fixture-altbash", [
    jline({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_ab1", name: "Bash", input: { command: "cat .claude/skills/fixture-altbash/MEMORY.md", description: "Read own memory" } }] } }),
    toolResult("toolu_ab1", "# memory\nentries...\n"),
  ]);

  // 10. ALT (shard) — blind channel 2: the correct read for a sharded skill targets the newest
  //     MEMORY-ARCHIVE-* shard, not the regenerated router the classifier keys on.
  write("fx10altshard", "fixture-altshard", [
    toolUse("toolu_as1", path.join(repo, ".claude", "skills", "fixture-altshard", "MEMORY-ARCHIVE-2026-06-01-2026-08-01.md")),
    toolResult("toolu_as1", "1\t## L1 ...\n"),
  ]);

  // 12. ALT (bash, CAPPED) — a head-bounded read of the family: page-1 delivery. Must NOT score
  //     as a full alt read (measured: 69.3% of live ALT commands were capped and read as exonerated).
  write("fx12altcapped", "fixture-altcapped", [
    jline({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_ac1", name: "Bash", input: { command: "head -120 .claude/skills/fixture-altcapped/MEMORY.md", description: "peek memory" } }] } }),
    toolResult("toolu_ac1", "# memory\nfirst page...\n"),
  ]);

  // 13. RED CONTROL: a worktree-isolated agent reads the ROUTER at a
  //     worktree prefix. It is a router read — OK with cap correlation — never "shard", never ALT.
  write("fx13wtrouter", "fixture-wtrouter", [
    toolUse("toolu_wt1", path.join(repo, ".claude", "worktrees", "agent-abc123", ".claude", "skills", "fixture-wtrouter", "MEMORY.md")),
    toolResult("toolu_wt1", "1\t# memory\n2\tentries...\n"),
  ]);

  // 11. NEGATIVE CONTROL (mention-vs-use) — the path appears ONLY in prose. The widened classifier
  //     must NOT absorb this: a mention is not a read, and this fixture is what keeps ALT_READ from
  //     swallowing every transcript that merely talks about memory files.
  write("fx11mention", "fixture-mention", [
    jline({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I did not open .claude/skills/fixture-mention/MEMORY.md — proceeding from the brief alone." }] } }),
  ]);

  return { root, repo, projects, sess, mem };
}

function selfTest() {
  const fx = buildFixture();
  const failures = [];
  let assertionCount = 0;
  const check = (name, actual, expected) => {
    assertionCount++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(48)} got ${JSON.stringify(actual)}${ok ? "" : `  expected ${JSON.stringify(expected)}`}`);
    if (!ok) failures.push(name);
  };

  console.log(`agent-memory-load-audit — mode: self-test`);
  console.log(`fixture corpus: ${fx.root}`);

  const { rows, corpus } = scanCorpus({ projectsDir: fx.projects, repoRoot: fx.repo });
  console.log(
    `corpus: ${corpus.sessionsScanned}/${corpus.sessionsAvailable} sessions scanned · ${corpus.metaFound} meta files found · ` +
      `${corpus.dispatchesClassified} dispatches classified · ${corpus.skillMemoryFilesOnDisk} skill MEMORY.md on disk`,
  );
  console.log("");

  // Positive control on the CORPUS ITSELF: if the scan silently walked an empty dir every
  // classification assertion below would vacuously... fail, but state it explicitly anyway.
  check("corpus size (dispatches classified)", corpus.dispatchesClassified, 13);
  check("corpus size (meta files found)", corpus.metaFound, 13);

  // The project-dir key is the SHARED port (scripts/lib/project-key.mjs), never a local regex: a
  // dot is a dash, a non-BMP character is TWO dashes (UTF-16 units), and a 230-unit key takes the
  // harness's `-` + base36(|hash|) suffix — the last two pinned from the harness's own code.
  check("encodeProjectDir: a dot becomes a dash", encodeProjectDir("/a/b.c"), "-a-b-c");
  check("encodeProjectDir: non-BMP -> two dashes", encodeProjectDir("/a/\u{1F4F7}b"), "-a---b");
  check("encodeProjectDir: 230 units -> oracle suffix", encodeProjectDir("/tmp/" + "x".repeat(225)), "-tmp-" + "x".repeat(195) + "-qled2p");

  const by = Object.fromEntries(rows.map((r) => [r.agentType, r]));
  const shape = (t) => (by[t] ? [by[t].cls, by[t].recovered] : ["MISSING", false]);

  check("fixture-ok         -> OK, not recovered", shape("fixture-ok"), ["OK", false]);
  check("fixture-byte       -> BYTE, ran blind", shape("fixture-byte"), ["BYTE", false]);
  check("fixture-token      -> TOKEN, recovered", shape("fixture-token"), ["TOKEN", true]);
  check("fixture-noattempt  -> NO_ATTEMPT", shape("fixture-noattempt"), ["NO_ATTEMPT", false]);
  check("ALT bash (relative path)   -> ALT_READ", shape("fixture-altbash"), ["ALT_READ", false]);
  check("ALT shard read             -> ALT_READ", shape("fixture-altshard"), ["ALT_READ", false]);
  check("alt subtype recorded (bash)", by["fixture-altbash"]?.altVia ?? null, "bash");
  check("alt subtype recorded (shard)", by["fixture-altshard"]?.altVia ?? null, "shard");
  // RED CONTROL: a head-bounded bash read is CAPPED, never a full alt read.
  check("ALT bash CAPPED (head -N)   -> ALT_READ", shape("fixture-altcapped"), ["ALT_READ", false]);
  check("alt subtype recorded (bash-capped)", by["fixture-altcapped"]?.altVia ?? null, "bash-capped");
  // RED CONTROL: a worktree-prefixed ROUTER read is a normal read, not its own opposite.
  check("worktree-prefixed router read -> OK (not ALT/shard)", shape("fixture-wtrouter"), ["OK", false]);
  // NEGATIVE CONTROL: a prose mention alone must survive the widening as NO_ATTEMPT.
  check("NEGATIVE CONTROL mention-only -> NO_ATTEMPT", shape("fixture-mention"), ["NO_ATTEMPT", false]);
  check("fixture-nomem      -> NO_MEMORY_FILE", shape("fixture-nomem"), ["NO_MEMORY_FILE", false]);
  // RED CONTROL: the decoy MUST classify OK. A path-blind probe says BYTE here.
  check("RED CONTROL decoy  -> OK (unrelated file capped)", shape("fixture-decoy"), ["OK", false]);
  // RED CONTROL: the silent class. is_error is FALSE on this read — only the attachment reveals it.
  check("RED CONTROL trunc  -> TRUNCATED (is_error false)", shape("fixture-trunc"), ["TRUNCATED", false]);
  check("fixture-noresult   -> NO_RESULT (not OK)", shape("fixture-noresult"), ["NO_RESULT", false]);
  check("byte cap detail parsed from the error", by["fixture-byte"]?.capDetail ?? null, "395.1KB");
  check("trunc detail parsed from the banner", by["fixture-trunc"]?.capDetail ?? null, "1-231 of 859 total (78963 tokens, cap 25000)");

  // MUST-FLAG demonstration + the 51x instrument lesson, printed firing.
  console.log("");
  console.log("  RED CONTROL — interleaved BYTE fixture (tool_result 7 records away from its tool_use):");
  const byteText = fs.readFileSync(path.join(fx.sess, "agent-fx02byte.jsonl"), "utf8");
  const memByte = fx.mem("fixture-byte");
  const correlated = classifyDispatch(byteText, memByte);
  const naive = naiveSameLineProbe(byteText, memByte);
  console.log(`    correlated (tool_use_id)  -> ${correlated.cls}${correlated.recovered ? " recovered" : " BLIND"}   [FLAGGED]`);
  console.log(`    naive same-line grep      -> ${naive} incident(s)  [BLIND — the cap error carries no file path]`);
  check("correlated probe flags the interleaved BYTE", correlated.cls, "BYTE");
  check("naive same-line probe is blind to it (=0)", naive, 0);

  console.log("");
  console.log("  RED CONTROL — silent truncation (is_error is FALSE; only the attachment discloses it):");
  const trText = fs.readFileSync(path.join(fx.sess, "agent-fx07trunc.jsonl"), "utf8");
  const trCls = classifyDispatch(trText, fx.mem("fixture-trunc"));
  const isErrorSeen = /"is_error":true/.test(trText);
  console.log(`    attachment-correlated     -> ${trCls.cls} (${trCls.capDetail})   [FLAGGED]`);
  console.log(`    is_error-only probe       -> no error anywhere in the transcript (is_error:true present = ${isErrorSeen}) [BLIND]`);
  check("attachment probe flags the silent truncation", trCls.cls, "TRUNCATED");
  check("is_error-only probe is blind to it (false)", isErrorSeen, false);

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} assertion(s) failed: ${failures.join(", ")}`);
    console.log(VERDICT_SELF_TEST_FAIL);
    return 1;
  }
  console.log(`all ${assertionCount} assertions passed over a ${corpus.dispatchesClassified}-dispatch synthetic corpus`);
  console.log(VERDICT_SELF_TEST_PASS);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `agent-memory-load-audit — did dispatched sub-agents actually load their own MEMORY.md?

  node scripts/agent-memory-load-audit.mjs --session <sid|8-hex-prefix>   one session (fast)
  node scripts/agent-memory-load-audit.mjs --fleet                        all sessions (~2.9 GB, minutes)
  node scripts/agent-memory-load-audit.mjs --self-test                    synthetic fixture corpus
  node scripts/agent-memory-load-audit.mjs --fleet --json                 machine-readable

  --projects-dir <path>   override ~/.claude/projects/<encoded-repo>
  --repo-root <path>      override the repo whose .claude/skills/*/MEMORY.md we resolve

A mode is REQUIRED. Bare invocation exits 2 on purpose: a runner with a helpful exit-0 path makes
every gate composed above it false-green.`;

function main(argv) {
  const args = argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => {
    const i = args.indexOf(f);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };

  const repoRootArg = val("--repo-root");
  const repoRoot = repoRootArg ?? REPO_ROOT;
  const projectsDir = val("--projects-dir") ?? (repoRootArg ? defaultProjectsDir(repoRootArg) : defaultProjectsDir());
  const asJson = has("--json");

  if (has("--self-test")) return selfTest();

  const sessionArg = val("--session");
  const fleet = has("--fleet");

  if (!sessionArg && !fleet) {
    console.error(USAGE);
    return 2;
  }

  let sessions;
  let mode;
  if (sessionArg) {
    if (!fs.existsSync(projectsDir)) {
      console.error(`projects dir not found: ${projectsDir}`);
      return 2;
    }
    const all = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const matches = all.filter((n) => n === sessionArg || n.startsWith(sessionArg));
    if (matches.length === 0) {
      console.error(`no session matching "${sessionArg}" under ${projectsDir}`);
      return 2;
    }
    if (matches.length > 1) {
      console.error(`ambiguous session prefix "${sessionArg}" — matches ${matches.length}: ${matches.slice(0, 5).join(", ")}`);
      return 2;
    }
    sessions = matches;
    mode = `session ${matches[0]}`;
  } else {
    mode = "fleet";
  }

  const started = Date.now();
  const result = scanCorpus({
    projectsDir,
    repoRoot,
    sessions,
    onProgress: asJson || sessions ? undefined : (m) => process.stderr.write(m + "\n"),
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        { mode, projectsDir, repoRoot, elapsedMs: Date.now() - started, corpus: result.corpus, summary: summarize(result.rows), rows: result.rows },
        null,
        2,
      ),
    );
    return 0;
  }

  printReport(mode, result);
  console.error(`(elapsed ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return 0;
}

// ⛔ REALPATH BOTH SIDES — see the same fix in `i18n-dead-key-scan.mjs`. Worse here than there:
// invoked by its real path this script exits 2 with usage (the callee-side "bare invocation must
// exit non-zero" rule), but through a symlink the compare is false and it exits 0 with NO output —
// so the fragile guard INVERTS a correct refusal into a pass for any gate reading rc.
// POLARITY: realpathed correctly but fell back to `false` on an unresolvable argv[1]. This file
// is the one whose refusal-inversion started the sweep, so it takes the SSOT rather than a second
// hand-rolled copy. SSOT: scripts/lib/is-main.mjs.
if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv));
}
