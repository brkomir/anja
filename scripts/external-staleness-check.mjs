#!/usr/bin/env node
/**
 * external-staleness-check.mjs
 *
 * Freshness gate for the external-* roster stat-blocks (2026-06-17, /external-audit) —
 * per-skill stats had silently drifted and nothing watched them.
 *
 * TWO frontmatter date fields, two freshness concepts (reshaped 2026-06-18 —
 * replaced a fragile prose-marker regex that depended on a human writing one of 4 exact
 * "re-catalog pending" phrasings, so a new wording silently passed GREEN-but-stale):
 *   last-fetched       — bumped on ANY verification touch (incl. a stats-only scout refresh).
 *   last-deep-catalog  — bumped ONLY on a DEEP body re-catalog (upstream re-read + body rewrite).
 * A stats-only touch bumps `last-fetched` GREEN while the BODY stays stale; `last-deep-catalog`
 * doesn't move, so its age downgrades the system — the stale body is caught by a date compare,
 * not a brittle marker. Each field is tiered; the system tier = the WORSE of the two:
 *   GREEN  <30d   · fresh
 *   YELLOW 30-89d · refresh soon (a self-refresh during the next scout/audit)
 *   RED    >=90d  · stale — do NOT trust the stat-block as load-bearing
 *   NOFIELD       · field absent (can't assess — surface as a gap)
 *   DRAFT         · a `catalog-basis: DRAFT …` line — body written from API reads, not yet clone-verified; fresh dates cannot make it GREEN
 *   FROZEN        · upstream unreachable (declared in upstream-status) — reported, never counted, a disposition not a refresh
 *   RETIRED       · roster retired the expert (a `status: RETIRED …` line) — record only, excluded from the count
 *
 * Usage:
 *   node scripts/external-staleness-check.mjs           # report table
 *   node scripts/external-staleness-check.mjs --strict  # exit 1 if any RED
 *
 * Plain CLI script (not Workflow-runtime), so `new Date()` is available and intended.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The checkout this file sits in, never a fixed path: a worktree run must read its own corpus.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS = join(ROOT, ".claude/skills");
const STRICT = process.argv.slice(2).includes("--strict");

const today = new Date();

// The YAML frontmatter body (between the two `---` fences), or null. One spelling for every reader below.
const frontmatterBody = (text) => text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? null;

function parseFrontmatterDate(text, field) {
  const fm = frontmatterBody(text);
  if (fm === null) return null;
  const re = new RegExp(`^${field}:`, "i");
  const line = fm.split("\n").find((l) => re.test(l));
  if (!line) return null;
  const date = line.match(/\d{4}-\d{2}-\d{2}/);
  return date ? date[0] : line.replace(re, "").trim();
}

function ageDays(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  return Math.floor((today - d) / 86_400_000);
}

const tierOf = (age) => (age === null ? "NOFIELD" : age < 30 ? "GREEN" : age < 90 ? "YELLOW" : "RED");
// WORSE-of severity rank (RED worst; NOFIELD = an unassessable gap, above YELLOW): a missing/old
// last-deep-catalog downgrades a GREEN-last-fetched system — this IS the gate's original catch, preserved.
// FROZEN (-1) and RETIRED (-2) are NOT freshness verdicts, so neither can be the "worse of"; below 0
// their rank is only the display sort (RETIRED last).
const TIER_RANK = { RETIRED: -2, FROZEN: -1, GREEN: 0, YELLOW: 1, NOFIELD: 2, DRAFT: 2, RED: 3 };
const worseOf = (a, b) => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);

// ⏸ FROZEN — an UNREACHABLE upstream (2026-08-11). Every tier above is a function of AGE alone,
// so a system whose upstream no longer exists ages GREEN -> YELLOW -> RED forever and NO ACTION
// CAN EVER CLEAR IT: the remedy this gate prescribes (a deep body re-catalog = upstream re-read
// + body rewrite) is impossible against a 404. That is an unclearable flag on a permanent gate,
// and an always-noisy gate is a disabled gate — the failure mode is that readers learn to skip
// the whole table. Measured: one cataloged system's upstream 404s (re-verified at source 2026-08-11,
// first recorded 2026-07-30), its SKILL.md declares the body a deliberate frozen historical
// record, and it was counted among "7 YELLOW · refresh via /external-audit" — advice that cannot
// be taken. FROZEN is reported, never counted as staleness, and never trips --strict; the real
// open item is a DISPOSITION ruling, not a refresh. Once ruled, the frontmatter records it
// and this line must NOT keep advertising an open fork — see the note in the FROZEN output.
// Keyed on a DOMAIN of unreachability words, never one spelling: the author who writes
// this field is describing a dead repo in prose, and "404" / "deleted" / "private" are as likely
// as "unreachable". It fires ONLY on an explicit `upstream-status` declaration, so a live system
// can never be laundered out of the staleness count by an old date alone.
const UNREACHABLE_RE = /unreachable|not\s*found|\b404\b|deleted|privated?|frozen|\barchived|gone/i;
// A NEGATED domain word describes a LIVE repo ("not archived", 2026-10-09). Strip negations before testing.
// A false FROZEN exempts a system from the staleness gate, so a missed spelling is the unsafe direction.
const NEGATED_RE = /\b(?:not|never|isn't|is\s+not|no\s+longer|not\s+yet)[\s-]+(?:been\s+)?(?:archived|deleted|private|frozen|gone)\b/gi;
export function upstreamStatusLine(text) {
  const fm = frontmatterBody(text);
  if (fm === null) return null;
  // the field is multi-line YAML prose; take the key line plus following indented continuations
  const lines = fm.split("\n");
  const i = lines.findIndex((l) => /^upstream-status:/.test(l));
  if (i < 0) return null;
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j]);
  return out.join(" ");
}
export const isFrozen = (text) => {
  const line = upstreamStatusLine(text);
  return !!line && UNREACHABLE_RE.test(line.replace(NEGATED_RE, " "));
};
// 🗄 RETIRED (2026-10-09) — the roster retired the expert: its agent file, generator entry and settings
// override are gone and the skill folder stays only as a frozen calibration RECORD. Declared by a
// `status: RETIRED …` frontmatter line, nothing else. It is reported in its own tier, excluded from the
// headline count, given none of the FROZEN disposition advice (that ruling has been made), never counted
// as staleness and never trips --strict. The upstream-status line is left as it was, so a retired system
// whose upstream is also unreachable still reads frozen on that predicate (the real-corpus self-test arm).
export const isRetired = (text) => /^status:\s*RETIRED(?![\w-])/m.test(frontmatterBody(text) ?? ""); // (?![\w-]): "RETIRED-PENDING" is not retired

// 📝 DRAFT (2026-10-09) — `catalog-basis: DRAFT …` marks a body written from API reads before the clone seat's PATCHes land
// (scout/SKILL.md § CLONE BEFORE YOU CATALOG). Its dates are real but the body is unverified, so a date-only tier reads it GREEN.
export const isDraft = (text) => /^catalog-basis:\s*DRAFT(?![\w-])/m.test(frontmatterBody(text) ?? "");
// The /external-audit panel↔roster drift line, or null when they agree. A function, not inline report code, so the
// self-test drives the same code the report runs (2026-10-10).
export function panelDrift(panelText, liveNames) {
  const panelNames = panelText === null ? [] : [...((panelText.split(/\n## Panel/)[1] ?? "").split(/\n## /)[0].matchAll(/^- `(external-[a-z0-9-]+)`/gm))].map((m) => m[1]);
  if (!panelNames.length) return "PANEL — external-audit.md § Panel not read (absent, or no `- \\`external-…\\`` bullet matched): roster↔panel unchecked.";
  const off = liveNames.filter((n) => !panelNames.includes(n)), dead = panelNames.filter((n) => !liveNames.includes(n));
  if (off.length || dead.length) return `PANEL drift — live but not on the /external-audit panel: ${off.join(", ") || "none"}; on the panel with no live system: ${dead.join(", ") || "none"}.`;
  return null;
}
// One system's row from its SKILL.md text. A function so the self-test reads the real tier wiring, never a replica (2026-10-10).
export function rowFor(name, text) {
  const lf = parseFrontmatterDate(text, "last-fetched");
  const dc = parseFrontmatterDate(text, "last-deep-catalog");
  const lfTier = tierOf(ageDays(lf));
  const dcTier = tierOf(ageDays(dc));
  const frozen = isFrozen(text);
  const retired = isRetired(text);
  return {
    name, lastFetched: lf ?? "—", deepCatalog: dc ?? "—",
    tier: retired ? "RETIRED" : frozen ? "FROZEN" : worseOf(worseOf(lfTier, dcTier), isDraft(text) ? "DRAFT" : "GREEN"), lfTier, dcTier, frozen, retired,
  };
}
const dirs = readdirSync(SKILLS).filter((d) => d.startsWith("external-"));
const rows = [];
for (const name of dirs) {
  let text;
  try {
    text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
  } catch {
    rows.push({ name, lastFetched: "(no SKILL.md)", deepCatalog: "—", tier: "RED", lfTier: "RED", dcTier: "RED" });
    continue;
  }
  rows.push(rowFor(name, text));
}
rows.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);

const icon = { GREEN: "🟢", YELLOW: "🟡", RED: "🔴", NOFIELD: "⚪", DRAFT: "📝", FROZEN: "⏸", RETIRED: "🗄" };
console.log("## External roster staleness (last-fetched + last-deep-catalog gate)\n");
console.log("| System | last-fetched | last-deep-catalog | Status |");
console.log("|---|---|---|---|");
for (const r of rows) {
  const flag = r.retired
    ? " — retired from the roster, record only; not counted"
    : r.frozen
    ? " — upstream unreachable; disposition, not refresh"
    : r.tier === "DRAFT" ? " — catalog-basis DRAFT: body not yet clone-verified"
    : TIER_RANK[r.dcTier] > TIER_RANK[r.lfTier] ? " ⚠️ deep-catalog stale" : "";
  console.log(`| ${r.name.replace("external-", "")} | ${r.lastFetched} | ${r.deepCatalog} | ${icon[r.tier]} ${r.tier}${flag} |`);
}

const retired = rows.filter((r) => r.tier === "RETIRED");
const live = rows.filter((r) => r.tier !== "RETIRED");
const red = rows.filter((r) => r.tier === "RED");
const yellow = rows.filter((r) => r.tier === "YELLOW");
const nofield = rows.filter((r) => r.tier === "NOFIELD");
const draft = rows.filter((r) => r.tier === "DRAFT");
const frozen = rows.filter((r) => r.tier === "FROZEN");
console.log(
  `\n${live.length} external systems · ${red.length} RED · ${yellow.length} YELLOW · ${nofield.length} NOFIELD · ${draft.length} DRAFT · ${frozen.length} FROZEN · ${live.length - red.length - yellow.length - nofield.length - draft.length - frozen.length} GREEN`,
);
const retiredFooter = retired.length
  ? `RETIRED — roster record only (a \`status: RETIRED\` frontmatter line); excluded from the count above, never a staleness finding, never trips --strict: ${retired.map((r) => r.name.replace("external-", "")).join(", ")}.`
  : null;
if (retiredFooter) console.log(retiredFooter);
if (draft.length) console.log(`DRAFT systems carry \`catalog-basis: DRAFT\` — written from API reads; their dates do not mean a clone read happened. Do not cite them as load-bearing until the clone seat's PATCHes land: ${draft.map((r) => r.name.replace("external-", "")).join(", ")}.`);
// PANEL (2026-10-09): /external-audit's fixed panel (.claude/commands/external-audit.md § Panel) is a hand copy of this roster; warn when they differ.
// Warn-only: it prints, it never touches the exit code (the --strict exit below reads RED alone).
const panelText = (() => { try { return readFileSync(join(ROOT, ".claude/commands/external-audit.md"), "utf8"); } catch { return null; } })();
const panelLine = panelDrift(panelText, live.map((r) => r.name));
if (panelLine) console.log(panelLine);
if (frozen.length) {
  console.log(`FROZEN systems have an UNREACHABLE upstream — a deep re-catalog is impossible, so they are excluded from the staleness counts and never trip --strict, and a stale last-deep-catalog date on one is EXPECTED, not a finding. Each needs a one-time DISPOSITION ruling via /external-audit, NOT a refresh; read the upstream-status frontmatter to see whether that ruling has already been made before treating it as open: ${frozen.map((r) => r.name.replace("external-", "")).join(", ")}.`);
}
if (red.length || yellow.length) {
  console.log(`Refresh via /external-audit or a scout self-refresh. A \`⚠️ deep-catalog stale\` flag needs a real DEEP body re-catalog + a \`last-deep-catalog\` bump — a stats-only \`last-fetched\` touch will NOT clear it.`);
}
if (nofield.length) {
  console.log(`NOFIELD systems lack a \`last-fetched\` or \`last-deep-catalog\` field — add both (last upstream verification + last deep body re-catalog) so they become gate-able.`);
}
if (STRICT && red.length) process.exit(1);

// ── self-test ────────────────────────────────────────────────────────────────
// Runs AFTER the report (the report is top-level and read-only), then exits with its own status.
// Asserts against the REAL exported `isFrozen`, never a replica — a replica self-test is
// structurally unfailable.
if (process.argv.slice(2).includes("--self-test")) {
  const fm = (extra) => `---\nname: x\nlast-fetched: 2026-01-01\nlast-deep-catalog: 2026-01-01\n${extra}description: y\n---\nbody`;
  let pass = 0, fail = 0;
  const ck = (label, got, want) => {
    if (got === want) { pass++; console.log(`  PASS ${label}`); }
    else { fail++; console.log(`  FAIL ${label} — expected ${want}, got ${got}`); }
  };
  console.log("\nexternal-staleness-check --self-test");

  // BASELINE POSITIVE CONTROL on the DETECTOR: it must be able to return true at all.
  ck("baseline: an explicit 404 declaration IS frozen",
     isFrozen(fm("upstream-status: repo returns HTTP 404, deleted or private\n")), true);

  // ⛔ THE DISCRIMINATING CONTROL. Same stale dates as the fixture above, no declaration.
  // If the predicate were keyed on AGE (the hypothesis being ruled out) both would read frozen;
  // keyed on the DECLARATION (the hypothesis being ruled in) only the first does. The two
  // predicted readings differ, so this control can actually fail.
  ck("DISCRIMINATING: identical stale dates, NO declaration -> NOT frozen",
     isFrozen(fm("")), false);

  // domain, not one spelling — the just-fixed corpus member uses "UNREACHABLE"+"404"
  for (const w of ["upstream is UNREACHABLE", "repo was deleted", "made private", "archived upstream", "the repo is gone"])
    ck(`domain word: "${w}"`, isFrozen(fm(`upstream-status: ${w}\n`)), true);

  // must NOT fire on an upstream-status that reports a HEALTHY repo
  ck("healthy upstream-status is NOT frozen",
     isFrozen(fm("upstream-status: live, verified at source, v2.1 current\n")), false);
  // 2026-10-09: a live system whose declaration says "not archived" must NOT read as frozen (the real corpus shape that misfired)
  ck("negated domain word: \"MIT, not archived\" is NOT frozen",
     isFrozen(fm("upstream-status: live, verified at source 2026-10-09 — pushed_at 2026-10-08, MIT, not archived; no archival or deprecation notice\n")), false);
  for (const w of ["isn't archived", "never archived", "unarchived", "not  archived", "no longer archived", "not deleted"])
    ck(`negated domain word: "${w}" is NOT frozen`, isFrozen(fm(`upstream-status: live, ${w}\n`)), false);
  ck("negation does not mask a real hit: \"deleted, not archived\" IS frozen",
     isFrozen(fm("upstream-status: deleted, not archived\n")), true);

  // multi-line YAML continuation must be read (the real file declares across several lines)
  ck("multi-line continuation is scanned",
     isFrozen(fm("upstream-status: >-\n  the repository page now\n  returns 404 with no redirect\n")), true);

  // the REAL corpus member must be recognised — validate the predicate against the artifact
  // it was written for, not only against fixtures (the just-fixed set is the test corpus).
  try {
    const real = readFileSync(join(SKILLS, retired[0].name, "SKILL.md"), "utf8"); // no retired system: TypeError, SKIP
    ck("REAL corpus: the retired system (404 upstream) is frozen", isFrozen(real), true);
  } catch { console.log("  SKIP real-corpus arm — SKILL.md unreadable"); }

  // RETIRED tier (2026-10-09): declared by a `status: RETIRED …` frontmatter line and nothing else
  ck("RETIRED: a status line declaring RETIRED is retired",
     isRetired(fm("status: RETIRED 2026-10-09 — agent removed\n")), true);
  ck("RETIRED: same dates and a frozen declaration but NO status line is NOT retired",
     isRetired(fm("upstream-status: repo returns HTTP 404\n")), false);
  ck("RETIRED: a status line with another value is NOT retired",
     isRetired(fm("status: LIVE\n")), false);
  ck("RETIRED: a hyphenated continuation (RETIRED-PENDING) is NOT retired",
     isRetired(fm("status: RETIRED-PENDING owner call\n")), false);
  try {
    const real = readFileSync(join(SKILLS, retired[0].name, "SKILL.md"), "utf8");
    ck("REAL corpus: the retired system (status: RETIRED) is retired", isRetired(real), true);
  } catch { console.log("  SKIP real-corpus RETIRED arm — SKILL.md unreadable"); }
  // Negatives for the predicate, and the tier / headline / footer the arms above never read.
  ck("RETIRED: \"Not retired\" prose and an indented status continuation are NOT retired",
     isRetired(fm("upstream-status: >-\n  live — Not retired then (RETIRED 2026-10-09, see `status:`)\n  status: RETIRED in a continuation\n")), false);
  ck("RETIRED: a status line in the BODY is NOT retired",
     isRetired(`${fm("")}\nstatus: RETIRED in a body paragraph\n`), false);
  if (!dirs.length) console.log("  SKIP real-corpus RETIRED-set arms — no external-* system in this tree");
  else {
    ck("REAL corpus: exactly one RETIRED row (a new retirement updates this arm)", retired.length, 1);
    ck("REAL corpus: the headline set holds no RETIRED row", live.some((r) => r.tier === "RETIRED"), false);
    ck("REAL corpus: the footer names every RETIRED system", retired.length > 0 &&
       retired.every((r) => (retiredFooter ?? "").includes(r.name.replace("external-", ""))), true);
  }

  ck("DRAFT: a catalog-basis DRAFT line is draft", isDraft(fm("catalog-basis: DRAFT 2026-10-09 — from API reads\n")), true);
  ck("DRAFT: a FULL CLONE basis is NOT draft", isDraft(fm("catalog-basis: FULL CLONE 2026-10-09 at abc\n")), false);
  ck("DRAFT: the word DRAFT under another key is NOT draft", isDraft(fm("version: 1.0 (the DRAFT was replaced)\n")), false);
  ck("DRAFT: catalog-basis: DRAFT mid-line under another key is NOT draft (the line anchor)", isDraft(fm("description: see catalog-basis: DRAFT mid-line\n")), false);
  // The tier wiring, not only the predicate: fresh dates, so GREEN is what the dates alone would say. No live DRAFT body
  // remains (edda's basis line is FULL CLONE since its clone seat landed), so this arm is the only reader of the ternary.
  const fresh = (extra) => fm(extra).replaceAll("2026-01-01", today.toISOString().slice(0, 10));
  ck("DRAFT: tier wiring — a fresh DRAFT body reads DRAFT, a fresh FULL CLONE body reads GREEN",
     [rowFor("x", fresh("catalog-basis: DRAFT 2026-10-09 — from API reads\n")).tier,
      rowFor("x", fresh("catalog-basis: FULL CLONE 2026-10-09 at abc\n")).tier].join(","), "DRAFT,GREEN");
  // 2026-10-09: a panel missing one live expert prints exactly one warn line naming it.
  ck("PANEL: a fixture panel missing one live expert yields one drift line naming it",
     panelDrift("# x\n## Panel (fixed)\n\n- `external-a` — a\n- `external-c` — c\n\n## Next\n- `external-b` — not the panel\n",
                ["external-a", "external-b", "external-c"]),
     "PANEL drift — live but not on the /external-audit panel: external-b; on the panel with no live system: none.");
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}
