#!/usr/bin/env node
/**
 * tracker-list.mjs — accurate per-group audit-history renderer for the three
 * audit trackers, powering `/flows list`, `/features list`, and `/ops list`.
 *
 * Usage:
 *   node scripts/tracker-list.mjs flows    [all|critical|high|standard|polish|coverage-gap]
 *   node scripts/tracker-list.mjs features [all|critical|high|standard|coverage-gap]
 *   node scripts/tracker-list.mjs ops      [all|webhooks|crons|async|api|embed|<substr>]
 *   (group defaults to `all`; add --brief for the dates-only compact view)
 *
 * WHY A SCRIPT, NOT INLINE AWK (the accuracy guarantee shared by all three):
 * the audit-history cell is APPEND-ONLY narrative — a row's redos / v2 / v3
 * re-audits are appended to the END of the cell, so the CURRENT closer sits at
 * the tail, not the headline. A naive head-truncation prints a STALE verdict
 * (a row's headline is its April v2 while the live-latest is the 2026-06-06
 * re-audit ~3 KB later). `latestDatedCell()` extracts the MAX-DATED verdict
 * by scanning the whole cell, and the Status column is read as the canonical
 * COMPLETE/PENDING token (per /flows).
 *
 * AUDIT-TIER COLUMNS (2026-06-19):
 * each row now carries a compact, machine-parseable `Audit Tiers` token in a
 * column inserted right after `Status`. The token surfaces WHEN each audit tier
 * last ran as scannable date columns (instead of decoding it from prose):
 *   - flows + features:  `v1:YYYY-MM-DD v2:… v3:… c:…`  (any key omitted = absent)
 *   - ops:               `prov:<YYYY-MM-DD | via-F17 | F2-v2> c:…`
 *                         (prov = audit provenance: an independent date OR the
 *                          inherited parent `via-F#`/`Flow#`; c = last `--code`)
 *   - never-audited row → token is literally `—` (all tiers render `—`).
 * v1 = initial `/expert-review`, v2 = `--final-audit`, v3 = `--v3-drift`/redo,
 * c = `--code` fix-wave review. `/audit-check` is the GATE (folds into the audit
 * it closed) — never its own tier. Each column shows the LATEST date that tier
 * ran; full multi-audit history stays in the narrative closer.
 *
 * HEADER-DRIVEN SPLICE (mid-migration correctness): the `Audit Tiers` column is
 * located by reading each table's HEADER row (not a fixed index) and spliced out
 * of the cells before the legacy positional extraction runs — so the renderer is
 * robust to the column-insertion regardless of where it lands, and the existing
 * Initial/Fixes/Final extraction is read at its original offsets unchanged.
 *
 * BACK-COMPAT (the renderer never breaks mid-backfill): a row whose table has NO
 * `Audit Tiers` column — or whose token cell is blank/unparseable — falls back to
 * the tail-aware date extraction. V1 is then derived from the Initial-Audit column
 * date (mirroring the backfill heuristic); v2/v3/--code render `—`; ops `Audit`
 * derives from the `Audited?` column date. The narrative CLOSER is always derived
 * from the tail-aware latest verdict, independent of the token, so even a `—`
 * (never-audited) token still surfaces any real latest verdict from prose.
 *
 * Two tracker shapes (and TWO coverage-gap sub-schemas — see coverageRow):
 *   - TIER trackers (flows, features) — four `### TIER` section tables
 *     (# | name | Status | [Audit Tiers] | Initial | Fixes | Final) + a bottom
 *     "Coverage-gap additions" table. flows' coverage-gap carries a Tier COLUMN;
 *     features' coverage-gap is untiered (# | Feature | Audit | Fixes | Final |
 *     Launch?) → its rows land in a synthetic `coverage-gap` group. Final =
 *     append-only.
 *   - CATEGORY tracker (ops) — `### <category>` section tables (Webhooks /
 *     Crons / Async / API / Embed), VARIABLE column count + per-section schema
 *     (Webhooks have Idempotent?/Alerting?; Crons have Alerting?; Async/API/
 *     Embed have neither) — these are located by header, not fixed index.
 */
import { readFileSync } from "node:fs";
import { trackerFiles } from "./lib/tracker-shards.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";
import { dirname, join } from "node:path";

// ---- shared cell helpers (the accuracy core, used by every tracker) ----
const clean = (s) => (s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const numOf = (cell) => parseInt((String(cell).match(/\d+/) || [0])[0], 10);

// Tail-aware extraction of the latest-dated verdict from an append-only cell.
function latestDatedCell(cell) {
  const c = clean(cell);
  if (!c || c === "—") return "—";
  const dates = [...c.matchAll(/\b20\d\d-\d\d-\d\d\b/g)].map((m) => m[0]);
  if (!dates.length) return cap(c, 120); // no date → headline is all there is
  const latest = dates.slice().sort().at(-1); // ISO dates sort lexically
  const idx = c.lastIndexOf(latest); // last occurrence = the live append
  const win = c.slice(Math.max(0, idx - 46), Math.min(c.length, idx + 110));
  return cap(`…${win}…`, 150);
}

// Clean MAX ISO-date across one or more raw cells — the "last audited" date.
// Powers the back-compat tier-date derivation (V1 from the Initial-Audit column,
// ops Audit from the Audited? column) when a row has no structured token yet.
function latestDateOf(...cells) {
  const dates = cells.flatMap((c) =>
    [...clean(c).matchAll(/\b20\d\d-\d\d-\d\d\b/g)].map((m) => m[0]));
  return dates.length ? dates.slice().sort().at(-1) : "—";
}

// ---- Audit Tiers token parse (additive structured column) ----
// Tolerant `key:value` scan over the fixed key set. Returns:
//   - null            → no structured token (column absent / blank / unparseable)
//                        → caller uses the back-compat tail-aware fallback.
//   - {}              → the literal `—` never-audited token (all tiers render `—`,
//                        NO fallback — the closer still surfaces prose as a net).
//   - { v1?, v2?, v3?, v4?, c?, prov? } → the parsed subset (missing keys render `—`).
function parseAuditTiersToken(raw) {
  if (raw == null) return null;
  const c = clean(raw);
  if (c === "") return null; // un-backfilled blank cell → back-compat
  if (c === "—") return {}; // explicit never-audited token (not back-compat)
  const out = {};
  // v4 is a tracked tier for both the flows and the features trackers.
  // `v4:` tokens were ALREADY in both trackers and were being
  // dropped SILENTLY here — no error, the key simply never entered `out` and
  // the column did not exist, so a fourth audit looked like it had never run.
  for (const m of c.matchAll(/\b(?:(v1|v2|v3|v4|c|prov)):(\S+)/g)) out[m[1]] = m[2];
  return Object.keys(out).length ? out : null; // junk (no recognized keys) → back-compat
}

// Detect a markdown table HEADER row (not a data row, not the `|---|` separator,
// not stray prose). Returns lowercased trimmed cells, or null. Used to locate the
// `Audit Tiers` column (and ops Idempotent?/Alerting? columns) by NAME, so the
// renderer survives the column being inserted at a position that varies per table.
function tableHeaderCells(line) {
  const cells = line.split("|").slice(1, -1);
  if (cells.length < 2) return null;
  if (cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) return null; // separator row
  const lc = cells.map((c) => c.trim().toLowerCase());
  if (!lc.some((h) => /\b(status|entry|feature|flow|final|audited|fixes)\b|audit tiers/.test(h)))
    return null; // not a recognizable table header
  return lc;
}

const findCol = (headerCells, re) => (headerCells ? headerCells.findIndex((h) => re.test(h)) : -1);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MEM = ".claude/project-memory";
const TIER_SET = ["critical", "high", "standard", "polish"];

const TRACKERS = {
  flows: {
    file: `${MEM}/project_critical_flows.md`,
    kind: "tier",
    idRe: /^\s*\|\s*(\d+)\s*\|/,
    label: (n) => `Flow #${n}`,
    tiers: TIER_SET,
    // coverage-gap schema: # | name | Tier | Status | Initial | Launch? | Notes
    // (cs is already Audit-Tiers-spliced, so these legacy offsets hold.)
    coverageRow: (cs) => {
      // ≥6 (not 7): tolerate a row authored under the main Initial|Fixes|Final shape
      // that landed in this Tier|Status|…|Launch?|Notes sub-table (e.g. Flow #65) —
      // render it with a best-effort closer, never silently DROP a row.
      if (cs.length < 6) return null;
      const t = clean(cs[2]).toLowerCase();
      if (!TIER_SET.includes(t)) return null;
      const status = clean(cs[3]) || "—";
      const closer = cap(clean(cs[cs.length - 1]) || "—", 130);
      return {
        num: numOf(cs[0]), name: clean(cs[1]), group: t, status,
        initial: clean(cs[4]) || "—",
        // "[coverage-gap]" tags a row that is still an OPEN gap; a COMPLETE
        // coverage-gap flow is a finished flow, not a gap → show its closer plainly
        // (it renders under its tier group like any first-class flow — e.g. Flow #65).
        final: (/\bCOMPLETE\b/i.test(status) ? "" : "[coverage-gap] ") + closer, schema: "B",
      };
    },
  },
  features: {
    file: `${MEM}/project_feature_audits.md`,
    kind: "tier",
    idRe: /^\s*\|\s*F(\d+)\s*\|/,
    label: (n) => `F${n}`,
    tiers: TIER_SET,
    // coverage-gap schema (untiered): # | Feature | Audit(status) | Fixes | Final | Launch?
    coverageRow: (cs) => {
      if (cs.length < 5) return null;
      return {
        num: numOf(cs[0]), name: clean(cs[1]), group: "coverage-gap",
        status: clean(cs[2]) || "—",
        // This sub-table has NO `Status` col (its 2nd col is `Audit`=verdict), so
        // the backfill skips it → no token → tierCells() takes the back-compat path
        // and reads V1 from `initial`. Carry the audit-date cells (Audit/Fixes +
        // Final) so V1 surfaces the audit date instead of a blank `—` (restores the
        // pre-tier-columns "Last Audit" value; final closer is unchanged).
        initial: `${clean(cs[3])} ${clean(cs[4])}`,
        final: latestDatedCell(cs[4]), schema: "B",
      };
    },
  },
  ops: {
    file: `${MEM}/project_ops_register.md`,
    kind: "category",
    idRe: /^\s*\|\s*O(\d+)\s*\|/,
    label: (n) => `O${n}`,
    aliases: { api: "rest api", embed: "embed", async: "async", crons: "cron", webhooks: "webhook" },
  },
};

const isDataRow = (l, cfg) => cfg.idRe.test(l);

// ---- per-row tier-cell resolution (token-driven, with back-compat fallback) ----
function tierCells(row) {
  const t = row.tiers;
  if (t === null) return { v1: latestDateOf(row.initial), v2: "—", v3: "—", v4: "—", c: "—" };
  return { v1: t.v1 || "—", v2: t.v2 || "—", v3: t.v3 || "—", v4: t.v4 || "—", c: t.c || "—" };
}
function opsAuditCells(row) {
  const t = row.tiers;
  if (t === null) return { audit: latestDateOf(row.auditedRaw), c: "—" };
  return { audit: t.prov || "—", c: t.c || "—" };
}

// ================= TIER trackers (flows, features) =================
function parseTier(lines, cfg, tracker, group, brief, collect = false) {
  const tierHdr = (l) => /^###\s+(CRITICAL|HIGH|STANDARD|POLISH)\b/i.exec(l);
  const coverageHdr = (l) => /^##\s+2026-04-18\b.*Coverage-gap/i.test(l);
  const rows = [];
  let tier = null;
  let coverage = false;
  let tiersIdx = -1; // index of the Audit Tiers column in the current table (-1 = absent)
  for (const line of lines) {
    const th = tierHdr(line);
    if (th) { tier = th[1].toLowerCase(); coverage = false; tiersIdx = -1; continue; }
    if (coverageHdr(line)) { tier = null; coverage = true; tiersIdx = -1; continue; }
    if (/^##\s/.test(line)) { tier = null; coverage = false; tiersIdx = -1; continue; }
    if (!isDataRow(line, cfg)) {
      const hc = tableHeaderCells(line);
      if (hc && (tier || coverage)) tiersIdx = findCol(hc, /audit tiers/);
      continue;
    }
    if (!tier && !coverage) continue;
    let cs = line.split("|").slice(1, -1);
    // Splice out the Audit Tiers cell so the legacy positional layout holds.
    let tiersRaw = null;
    if (tiersIdx >= 0 && tiersIdx < cs.length) {
      tiersRaw = cs[tiersIdx];
      cs = cs.slice(0, tiersIdx).concat(cs.slice(tiersIdx + 1));
    }
    const tiers = parseAuditTiersToken(tiersRaw);
    if (coverage) {
      const r = cfg.coverageRow ? cfg.coverageRow(cs) : null;
      if (r) { r.tiers = tiers; rows.push(r); }
    } else if (tier) {
      if (cs.length < 6) continue;
      rows.push({
        num: numOf(cs[0]), name: clean(cs[1]), group: tier,
        status: clean(cs[2]) || "—", initial: clean(cs[3]) || "—",
        final: latestDatedCell(cs.slice(5).join("|")), tiers, schema: "A",
      });
    }
  }
  // dedup by number — a full-schema row (A) wins over a coverage-gap stub (B)
  const byNum = new Map();
  for (const r of rows) if (!byNum.has(r.num) || r.schema === "A") byNum.set(r.num, r);
  const all = [...byNum.values()];

  const order = [...cfg.tiers, "coverage-gap"];
  const present = order.filter((g) => all.some((r) => r.group === g));
  const targets = group === "all" ? present : [group];

  if (collect) return all;
  const colName = tracker === "features" ? "Feature" : "Flow";
  const out = [`## /${tracker} list ${group}\n`];
  let gDone = 0, gTotal = 0;
  for (const t of targets) {
    const tr = all.filter((r) => r.group === t).sort((a, b) => a.num - b.num);
    if (!tr.length) continue;
    const done = tr.filter((r) => /\bCOMPLETE\b/i.test(r.status)).length;
    gDone += done; gTotal += tr.length;
    out.push(`### ${t.toUpperCase()} — ${tr.length} (${done} ✅ COMPLETE / ${tr.length - done} other)\n`);
    if (brief) {
      out.push(`| # | ${colName} | Status | V1 | V2 | V3 | V4 | --code |`);
      out.push(`|---|---|---|---|---|---|---|---|`);
      for (const r of tr) {
        const c = tierCells(r);
        out.push(`| ${cfg.label(r.num)} | ${cap(r.name, 50)} | ${r.status} | ${c.v1} | ${c.v2} | ${c.v3} | ${c.v4} | ${c.c} |`);
      }
    } else {
      out.push(`| # | ${colName} | Status | V1 | V2 | V3 | V4 | --code | Latest verdict |`);
      out.push(`|---|---|---|---|---|---|---|---|---|`);
      for (const r of tr) {
        const c = tierCells(r);
        out.push(`| ${cfg.label(r.num)} | ${cap(r.name, 44)} | ${r.status} | ${c.v1} | ${c.v2} | ${c.v3} | ${c.v4} | ${c.c} | ${r.final} |`);
      }
    }
    out.push("");
  }
  if (gTotal && (group === "all" || targets.length > 1)) out.push(`**Total: ${gTotal} · ${gDone} ✅ COMPLETE · ${gTotal - gDone} other**`);
  if (!gTotal) out.push(`(no ${tracker} rows in group "${group}". Groups present: ${present.join(" · ")})`);
  return out.join("\n");
}

// ================= CATEGORY tracker (ops) =================
function parseCategory(lines, cfg, group, brief, collect = false) {
  const secHdr = (l) => /^###\s+(.+?)\s*$/.exec(l);
  const rows = [];
  let section = null;
  let cols = { tiersIdx: -1, idempotentIdx: -1, sentryIdx: -1 };
  for (const line of lines) {
    const sh = secHdr(line);
    if (sh) { section = sh[1].trim(); cols = { tiersIdx: -1, idempotentIdx: -1, sentryIdx: -1 }; continue; }
    if (/^##\s/.test(line)) { section = null; cols = { tiersIdx: -1, idempotentIdx: -1, sentryIdx: -1 }; continue; } // left the table region
    if (!section) continue;
    if (!isDataRow(line, cfg)) {
      const hc = tableHeaderCells(line);
      if (hc) {
        const tiersIdx = findCol(hc, /audit tiers/);
        // Idempotent?/Alerting? indices are computed on the Audit-Tiers-SPLICED
        // header so they align with the spliced data cells below.
        const spliced = tiersIdx >= 0 ? hc.slice(0, tiersIdx).concat(hc.slice(tiersIdx + 1)) : hc;
        cols = {
          tiersIdx,
          idempotentIdx: findCol(spliced, /idempotent/),
          sentryIdx: findCol(spliced, /sentry|alerting/),
        };
      }
      continue;
    }
    let cs = line.split("|").slice(1, -1);
    let tiersRaw = null;
    if (cols.tiersIdx >= 0 && cols.tiersIdx < cs.length) {
      tiersRaw = cs[cols.tiersIdx];
      cs = cs.slice(0, cols.tiersIdx).concat(cs.slice(cols.tiersIdx + 1));
    }
    if (cs.length < 5) continue; // # | entry | status | audited? | … | notes
    const tiers = parseAuditTiersToken(tiersRaw);
    rows.push({
      num: numOf(cs[0]), section,
      entry: clean(cs[1]), status: clean(cs[2]) || "—",
      auditedRaw: cs[3], // for the back-compat Audit date (Audited? column)
      idempotent: cols.idempotentIdx >= 0 ? cap(clean(cs[cols.idempotentIdx]) || "—", 48) : "—",
      sentry: cols.sentryIdx >= 0 ? cap(clean(cs[cols.sentryIdx]) || "—", 48) : "—",
      tiers,
    });
  }
  const want = cfg.aliases[group] || group;
  const sections = [...new Set(rows.map((r) => r.section))];
  const shown = group === "all" ? sections : sections.filter((s) => s.toLowerCase().includes(want));
  // `collect` (the --counts path) returns the rows BEFORE the no-match message: on an ops register with no
  // rows, `shown` is empty and the message string came back in place of an array, so countsOf iterated
  // its characters and printed one status-less "row" per character.
  if (collect) return rows;
  const out = [`## /ops list ${group}\n`];
  if (!shown.length) {
    out.push(rows.length ? `No ops sections match "${group}". Sections: ${sections.join(" · ")}`
      : "No ops entries yet: the register has no rows.");
    return out.join("\n");
  }
  let gDone = 0, gTotal = 0;
  for (const s of shown) {
    const sr = rows.filter((r) => r.section === s).sort((a, b) => a.num - b.num);
    if (!sr.length) continue;
    const done = sr.filter((r) => /\bCOMPLETE\b/i.test(r.status)).length;
    gDone += done; gTotal += sr.length;
    out.push(`### ${s} — ${sr.length} (${done} ✅ COMPLETE / ${sr.length - done} other)\n`);
    if (brief) {
      out.push(`| # | Entry | Status | Audit | --code |`);
      out.push(`|---|---|---|---|---|`);
      for (const r of sr) {
        const a = opsAuditCells(r);
        out.push(`| ${cfg.label(r.num)} | ${cap(r.entry, 52)} | ${r.status} | ${a.audit} | ${a.c} |`);
      }
    } else {
      // The register column may say "Sentry alerts?" or "Alerting?" (both parse into
      // r.sentry); the rendered header names what it holds, not one vendor.
      out.push(`| # | Entry | Status | Audit | --code | Idempotent? | Alerting? |`);
      out.push(`|---|---|---|---|---|---|---|`);
      for (const r of sr) {
        const a = opsAuditCells(r);
        out.push(`| ${cfg.label(r.num)} | ${cap(r.entry, 46)} | ${r.status} | ${a.audit} | ${a.c} | ${r.idempotent} | ${r.sentry} |`);
      }
    }
    out.push("");
  }
  out.push(`**Total: ${gTotal} ops entries · ${gDone} ✅ COMPLETE · ${gTotal - gDone} other**`);
  return out.join("\n");
}

// ---- public render entry (used by both the CLI and the test suite) ----
function render(tracker, group = "all", { brief = false, lines, collect = false } = {}) {
  const cfg = TRACKERS[(tracker || "").toLowerCase()];
  if (!cfg) throw new Error(`Unknown tracker "${tracker}". Use: ${Object.keys(TRACKERS).join(" | ")}`);
  if (!Array.isArray(lines)) throw new Error("render() requires { lines: string[] }");
  const g = (group || "all").toLowerCase();
  return cfg.kind === "tier"
    ? parseTier(lines, cfg, tracker.toLowerCase(), g, brief, collect)
    : parseCategory(lines, cfg, g, brief, collect);
}

// ---- per-status counts (--counts) ----
// WHY THIS EXISTS. The tracker POINTERS carry a per-status breakdown ("69 flows (64 COMPLETE /
// 4 RESEARCH_GAP / 1 NOT AUDITED)"), and `--brief` only ever emitted COMPLETE-vs-other. So every
// consumer that needed the breakdown hand-rolled an awk over the raw markdown, and those copies
// are where the whole defect family lives: same bug fixed three times in seven days, in three
// different ways, with zero propagation between the copies (wrap · flows ·
// orient). This closes the gap in the ONE place that is shard-aware and schema-aware,
// so the copies can be deleted rather than repaired.
//
// The vocabulary is `wrap/SKILL.md`'s shipped `vocab()`, ported rather than reinvented — porting
// it was the review's own prescribed order (fix the predicate, port the vocabulary, then the
// question dissolves under the executable).
//
// ⛔ UNRECOGNISED IS A REFUSAL, NOT A BUCKET. A hand-rolled awk answers an unknown status by
// silently bucketing it, which is how a date token came to be counted as a status. Here it sets
// rc=1 and names the ids, because the consuming step's next action is to EDIT a pointer off this
// count — a wrong count routes straight into a corrupting write.
// ⛔ THE VOCABULARY IS PER-TRACKER, AND MY FIRST VERSION OF THIS WAS NOT. I ported `wrap`'s
// `vocab()` as one shared list across all three trackers — and that file's own SCOPE comment says,
// in the paragraph directly above the function, that it is written for the flows tracker
// ALONE, "one path, one vocabulary… Re-derive the id class and the status vocabulary per tracker."
// I made the exact mistake the source I was porting from warns about, and it surfaced as a STOP on
// 5 of 32 healthy feature rows and 2 of 54 healthy ops rows — a guard refusing correct data, which
// is worse than the silence it replaced because it would block a session start on a true reading.
// Derived from the live trackers rather than guessed (each list sums to that tracker's row count).
// flows also carries WIP: no live row holds it today, but the /flows spec names `🔧 WIP` among the
// canonical Status tokens, so a row that follows the spec must not make --counts refuse.
const STATUS_VOCAB = {
  flows:    ["COMPLETE", "RESEARCH_GAP", "WIP", "NOT AUDITED", "PENDING"],
  features: ["COMPLETE", "RESEARCH_GAP", "COVERED-DEFERRED", "COVERED-BY", "IN PROGRESS", "SCOPED", "RESEARCHED", "PENDING"],
  ops:      ["COMPLETE", "NOT AUDITED", "CLOSED", "AUDITED", "PENDING"],
};
// An em-dash or empty cell is the trackers' own "no status recorded" marker, so it is a COUNTED
// bucket rather than a refusal — visible in the output, which is the branch `bash-environment.md`
// permits ("paste the matched-set count beside the verdict"). Refusing on it would block on a true
// reading; hiding it would be the silence this whole change exists to remove.
const NO_STATUS = "(none)";
function vocabOf(raw, tracker) {
  const v = String(raw || "").replace(/^[^A-Za-z—]+/, "").trim();
  if (v === "" || v === "—") return NO_STATUS;
  const list = STATUS_VOCAB[String(tracker || "").toLowerCase()] || [];
  return list.find((k) => v.toUpperCase().startsWith(k)) || "";
}
function countsOf(tracker, { lines }) {
  const rows = render(tracker, "all", { lines, collect: true });
  const buckets = new Map();
  const unrecognised = [];
  for (const r of rows) {
    const k = vocabOf(r.status, tracker);
    if (!k) { unrecognised.push(String(r.num ?? "?")); continue; }
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  return { total: rows.length, buckets, unrecognised };
}
function renderCounts(tracker, { lines }) {
  const { total, buckets, unrecognised } = countsOf(tracker, { lines });
  const order = [...(STATUS_VOCAB[String(tracker || "").toLowerCase()] || []), NO_STATUS];
  const ordered = order.filter((k) => buckets.has(k)).map((k) => `${buckets.get(k)} ${k}`);
  const out = [`${total} ${tracker} (${ordered.join(" / ")})`];
  if (unrecognised.length) {
    out.push(`STOP - ${unrecognised.length} row(s) carry a status this vocabulary does not recognise ` +
             `(ids: ${unrecognised.join(" ")}) - do NOT edit any pointer off this count.`);
  }
  return { text: out.join("\n"), ok: unrecognised.length === 0 };
}

function main(argv) {
  const rawArgs = argv.slice(2);
  const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
  const positional = rawArgs.filter((a) => !a.startsWith("--"));
  const brief = flags.has("--brief");
  const wantCounts = flags.has("--counts");
  const [trackerArg, groupArgRaw] = [positional[0], positional[1]];
  const tracker = (trackerArg || "").toLowerCase();
  const cfg = TRACKERS[tracker];
  if (!cfg) {
    console.error(`Unknown tracker "${trackerArg}". Use: ${Object.keys(TRACKERS).join(" | ")}`);
    process.exit(2);
  }
  const group = (groupArgRaw || "all").toLowerCase();
  if (cfg.kind === "tier" && group !== "all" && ![...cfg.tiers, "coverage-gap"].includes(group)) {
    console.error(`Unknown ${tracker} group "${group}". Use: all | ${cfg.tiers.join(" | ")} | coverage-gap`);
    process.exit(2);
  }
  let lines;
  try {
    // Router + shards. Returns just the one file until the flows split lands, so this is a
    // no-op today; after it, a bare single-file read would silently show only the legend.
    lines = trackerFiles(join(ROOT, cfg.file)).flatMap((f) => readFileSync(f, "utf8").split("\n"));
  } catch (e) {
    console.error(`Cannot read tracker: ${cfg.file}\n${e.message}`);
    process.exit(2);
  }
  if (wantCounts) {
    const { text, ok } = renderCounts(tracker, { lines });
    console.log(text);
    process.exit(ok ? 0 : 1);
  }
  console.log(render(tracker, group, { brief, lines }));
  // A STATUS COLUMN IS A CLAIM, NOT EVIDENCE — emitted with every listing, on purpose.
  // The codified rule lived only in the backlog
  // skill; `ops`, `flows` and `features` all read their trackers through THIS file and
  // carried it zero times each (measured 2026-09-19). A line in each spec relies on the
  // spec being read at the right moment; a footer here fires at the moment the labels are
  // in front of the reader, which is the only moment it can change what they relay.
  console.log(
    "\n⚠️  The Status column above is a CLAIM written by whoever last touched the row, not" +
      "\n    evidence. Before RELAYING any of it — to the owner, to a peer, into a readout —" +
      "\n    cross-check against git: `git log --oneline -- <file>`. A row reading done/applied/" +
      "\n    shipped whose commit you have not seen is unverified, and saying so costs nothing.",
  );
}

// CLI guard — only runs the file-reading entrypoint on direct `node` execution,
// so `import`ing the module (tests) triggers no argv parse / file read / stdout.
if (isMainModule(import.meta.url)) {
  main(process.argv);
}

export { renderCounts, countsOf, vocabOf, render, parseAuditTiersToken, latestDatedCell, latestDateOf, TRACKERS, tableHeaderCells, findCol };
