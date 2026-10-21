#!/usr/bin/env node
/**
 * section-cite-check.mjs — find SECTION CITATIONS that point at a heading the
 * cited file no longer holds.
 *
 * WHY: the rule, skill and doctrine files cite each other by section —
 * `` `<file>.md` § <HEADING TEXT> `` — and three moves left many of those cites
 * pointing at a file that no longer holds the heading: sections relocated
 * between the orchestrator files (2026-09-03), shell-trap entries moved to
 * `.claude/traps/shell-traps.md` (2026-09-21), and sections parked into the
 * rules archive's round-three parked files (2026-09-23). A hand pass
 * fixed 72 such slips across 21 files; nothing detected them. This
 * is the detector. Read-only: it never edits a file.
 *
 * CORPUS: every `*.md` under .claude/{rules,orchestrator,skills,docs,traps,
 * agents,templates} plus CLAUDE.md and AGENTS.md — the WORKTREE files.
 * `--dir <path>` overrides the root (the self-test fixture, the release copy).
 *
 * EXTRACTION, per line (code fences INCLUDED — each cite carries `fenced` so a
 * reader can filter):
 *   - section cite: `` `<name>.md` § <text> ``, `` `<name>.md § <text>` ``, a
 *     bare `<name>.md § <text>` and the link form `[...](<name>.md) § <text>`.
 *     The text runs to ` — `, ` (`, ` · `, ` §` / ` and §` (a chained second
 *     cite, not extracted), `;`, `. `, `**`, `*`, `)`, `|`, a backtick that closes
 *     the cite or opens another file cite, or end of line; quotes and trailing
 *     punctuation are stripped. A quoted `§ "..."` and an emphasised `§ *...*` /
 *     `§ **...**` are taken whole.
 *   - `§` followed by a digit (`§ 2`, `§4A`, `§2b`) is a NUMBERED cite: counted
 *     in its own class, never resolved. Exception: `§ 2026-09-02` is a dated
 *     heading (the archives use them) and IS resolved.
 *   - `§ X` / `§ N` / `§ <heading>` / `§ …` is prose ABOUT the form, and `§ (` names
 *     no heading at all: both are `placeholder`.
 *   - `<name>.md:<digits>` (in or out of backticks) is a LINE cite: counted,
 *     never validated — the house rule is cite headings, never lines.
 *
 * RESOLUTION of <name>: a path with a directory resolves against the repo root,
 * then the citing file's directory, then as a unique path SUFFIX within the
 * corpus (`wrap/SKILL.md`); a bare basename resolves to the corpus file(s)
 * with that basename — one ⇒ resolved, none ⇒ `file-missing`, several ⇒
 * `ambiguous`. A cite whose file EXISTS outside the corpus is `out-of-corpus`:
 * existence checked, heading not read. For a bare name that means one existence
 * check each at the root, in the project-memory directory and in plans, then a
 * basename index of the vendored Next.js docs. `~/…` and `http…` are `external`.
 *
 * VENDORED DOCS (node_modules/next/dist/docs). A directory-prefixed cite that
 * matches nothing above resolves there when its segments are the LAST segments
 * of a vendored path, each compared with the docs' `NN-` ordering prefix
 * stripped (`route-segment-config/maxDuration.md` →
 * `…/02-route-segment-config/maxDuration.md`): existence only, `out-of-corpus`.
 * Vendor paths are taken relative to the docs root, so `docs/x.md` never matches
 * the root's own name. When that directory is ABSENT (a checkout without
 * node_modules) a cite that would have needed it — a bare name found nowhere
 * else, or a directory-prefixed name whose first segment is neither a dot-dir
 * nor an existing root directory — is `out-of-corpus` flagged `unchecked`,
 * never `file-missing`, and the summary prints one warning line with the count.
 * A cite into a repo directory (`.claude/rules/gone.md`, `plans/gone.md`) still
 * reads `file-missing` without node_modules: it cannot be a vendored doc.
 *
 * AMBIGUOUS TIE-BREAK. When several corpus files carry the cited name, the
 * candidate nearest the citing file wins first look: walk up from the citing
 * file's directory and take the first ancestor holding a candidate (a skill's
 * `references/x.md` citing `SKILL.md` lands on that skill's own SKILL.md). That
 * candidate goes through the SAME matcher as a single-file cite (`classifyIn`:
 * headings, bold run-ins, aliases); a strong match is `resolved` with the target
 * named and `tieBreak` set. Anything else falls through to `ambiguous`, whose
 * `holding` list is computed by that same matcher over every candidate.
 *
 * HISTORY FILES. A cite whose CITING file is a history file — basename
 * `MEMORY*.md` or `CHANGELOG*.md` (the live MEMORY.md / CHANGELOG.md routers and
 * every dated shard), or any file under .claude/docs/rules-ARCHIVE/ — keeps its
 * class but is reported as `history:<class>` and NEVER fails the run: those files
 * record what was true when written, and a cite there going dead is the record
 * aging, not a broken pointer a reader will follow. History counts print on
 * their own summary line.
 *
 * PROVENANCE HEADERS. A section cite on a `## from ` / `### from ` heading line
 * (outside a fence) names where the text below it came from — the shell-traps
 * table's `## from \`bash-environment.md\` § X` headers — and the source section
 * may since have been parked or moved. Class `provenance`, counted, non-failing:
 * a fix that re-points citations has nothing to re-point there.
 *
 * UPSTREAM PATHS. An external-* skill (`.claude/skills/external-<name>/`) reviews
 * an upstream repo, so a relative path there that names no file in this tree
 * (`docs/agents.md`) names the upstream tree. Class `upstream`, counted,
 * non-failing. A dot-path (`.claude/rules/gone.md`) cited from those files is a
 * local pointer and still reads `file-missing`.
 *
 * HEADING MATCH: both sides normalised (backticks, `*`, `_`, double quotes and
 * pictographs stripped, leading symbols dropped, whitespace collapsed,
 * case-folded, trailing punctuation dropped). `#` lines inside a code fence are
 * NOT headings. A cite resolves when
 *   - a heading starts with the cited text at a word boundary (a cite quoting a
 *     first clause; `§ Comm` does not name `## Commands`), or
 *   - the cited text runs on past the whole heading, or past its lead clause
 *     (the text before its first ` — `, ` (`, `: `, `, `), at a word boundary —
 *     a lead under 12 chars needs a punctuation boundary or a step-shaped next
 *     token (`§ Process, step 1b`, `§ Process 4b` → `## Process`; `§ Processing`
 *     and `§ Commands index` do not), or
 *   - the cite's own first clause (before `,`/`:`, ≥12 chars) is a prefix of the
 *     heading (`§ CALIBRATE AN EXPOSURE REPORT, and I said so`).
 * No `#` heading ⇒ the same test over bold run-ins (`**TEXT**` at line start or
 * after a list marker or a leading symbol): class `bold-heading`. `AGENTS.md § X` also resolves
 * against `.claude/orchestrator/conventions.md`, a redirect AGENTS.md itself
 * declares: class `alias`. A cite sharing only a ≥16-char, ≥2-word prefix with a
 * heading before diverging — or whose raw text opens with an ALLCAPS run of ≥2
 * words and ≥8 chars that is a word-boundary prefix of a heading, then carries on
 * in lower-case prose (`§ SIZE A RAISE names the fold`) — is `weak-prefix`:
 * usually a cite that quoted the heading's first words and carried on in prose,
 * counted apart (listed under `--all`), and it does not fail the run.
 * Everything else is `heading-missing`.
 *
 * Usage:
 *   node scripts/section-cite-check.mjs            dead cites (live, then history) + summary
 *   node scripts/section-cite-check.mjs --all      every cite, resolved too
 *   node scripts/section-cite-check.mjs --quiet    every FAILING finding line, then the summary
 *   node scripts/section-cite-check.mjs --json     the same as JSON
 *   node scripts/section-cite-check.mjs --dir <p>  scan another root
 *   node scripts/section-cite-check.mjs --self-test   fixture + negative controls
 *
 * Exit: 0 = no heading-missing / file-missing cite in a LIVE file; 1 = at least
 * one; 2 = usage error, an unreadable root or corpus directory, or an empty
 * corpus. `ambiguous`, `weak-prefix`, `provenance`, `upstream`, an `unchecked` out-of-corpus
 * cite and every `history:` finding do not fail the run (`isFailing`, `exitCode`).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib/is-main.mjs";

const CORPUS_DIRS = [
  ".claude/rules",
  ".claude/orchestrator",
  ".claude/skills",
  ".claude/docs",
  ".claude/traps",
  ".claude/agents",
  ".claude/templates",
];
const CORPUS_FILES = ["CLAUDE.md", "AGENTS.md"];
/** Redirects a file declares about itself, keyed by REPO-RELATIVE path (so a key names one
 *  file, never a same-named file elsewhere). AGENTS.md: "A pointer of the form
 *  'AGENTS.md § X' resolves there" (the orchestrator conventions file). */
const ALIASES = { "AGENTS.md": [".claude/orchestrator/conventions.md"] };
/** Homes a bare-name cite may point into without being corpus: each is probed by ONE
 *  existence check on `<dir>/<name>`, never listed or read. */
const OUT_OF_CORPUS_FLAT = [".claude/project-memory", "plans"];
/** The vendored framework docs AGENTS.md sends every seat to; walked for basenames only. */
const VENDOR_DOCS = "node_modules/next/dist/docs";
const DEAD_CLASSES = ["heading-missing", "file-missing", "ambiguous"];
const FAILING = new Set(["heading-missing", "file-missing"]);
/** The classes a matcher returns when the cited text IS in the file (or its declared redirect). */
const STRONG = new Set(["resolved", "bold-heading", "alias"]);
const LONG_HEADING = 12;
/** History files: they record what was true when written, so a dead cite there never fails. */
const HISTORY_BASENAMES = [/^MEMORY.*\.md$/, /^CHANGELOG.*\.md$/];
const HISTORY_DIR = ".claude/docs/rules-ARCHIVE/";
/** A provenance header: a level-2/3 heading opening `from `, naming where the text came from. */
const PROVENANCE = /^#{2,3}\s+from\s/;
/** A file in an external-* skill, which reviews an upstream repo: its relative paths name that repo. */
const UPSTREAM_CITER = /^\.claude\/skills\/external-[^/]+\//;

export function isHistoryFile(rel) {
  return HISTORY_BASENAMES.some((re) => re.test(path.posix.basename(rel))) || rel.startsWith(HISTORY_DIR);
}

/** The one spelling of "this finding fails the run": a failing class in a LIVE file. */
export function isFailing(f) {
  return FAILING.has(f.class) && !f.history;
}

// ------------------------------------------------------------------ corpus

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // A missing dir is not part of the corpus; an UNREADABLE one is an instrument failure
    // (scan throws, main exits 2) — never a silently smaller corpus that reads clean.
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return;
    throw err;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(p);
    } else if (e.isSymbolicLink() && e.name.endsWith(".md")) {
      try {
        if (fs.statSync(p).isFile()) out.push(p);
      } catch {
        /* dangling link: not part of the corpus */
      }
    }
  }
}

function listCorpus(root) {
  const abs = [];
  for (const d of CORPUS_DIRS) walk(path.join(root, d), abs);
  for (const f of CORPUS_FILES) if (fs.existsSync(path.join(root, f))) abs.push(path.join(root, f));
  return [...new Set(abs.map((a) => path.relative(root, a).split(path.sep).join("/")))].sort();
}

const FENCE = /^\s{0,3}(```|~~~)/;

/** Parse a file once: lines with fence flags, `#` headings (outside fences), bold run-ins. */
function parseFile(text) {
  const lines = text.split(/\r?\n/);
  const fenced = [];
  const headings = [];
  const bolds = [];
  let inFence = false;
  let fenceMark = "";
  for (const line of lines) {
    const m = line.match(FENCE);
    if (m) {
      if (!inFence) {
        inFence = true;
        fenceMark = m[1];
        fenced.push(true);
        continue;
      }
      if (m[1] === fenceMark) {
        inFence = false;
        fenced.push(true);
        continue;
      }
    }
    fenced.push(inFence);
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      headings.push(h[1]);
      continue;
    }
    // A run-in may sit behind a list marker and/or a leading symbol ("⛔ **ONE EXCEPTION**").
    const b = line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)?(?:[\p{S}\uFE0F]+\s*)?\*\*(.+?)\*\*/u);
    if (b) bolds.push(b[1]);
  }
  return { lines, fenced, headings, bolds };
}

// ------------------------------------------------------------- normalising

export function norm(s) {
  return s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/[`*_]/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{S}§#>\s]+/u, "")
    .toLowerCase()
    .replace(/[\s.,:;!?'\-]+$/u, "")
    .trim();
}

/** Does cite `c` run on past heading-or-head `h` at an acceptable boundary? A long `h`
 *  needs only a word boundary; a short one needs punctuation ("process, step 1b") or a
 *  step-shaped next token ("process 4b") — "processing" and "commands index" never match. */
function runsOnPast(c, h) {
  if (!h || !c.startsWith(h)) return false;
  const rest = c.slice(h.length);
  if (rest === "") return true;
  if (/^[\p{L}\p{N}]/u.test(rest)) return false;
  if (h.length >= LONG_HEADING) return true;
  return !rest.startsWith(" ") || /^ (?:step )?\d/.test(rest);
}

/** The heading's lead clause: the text before its first ` - `, ` (`, `: ` or `, `. A cite
 *  quotes the lead clause of a long heading and then carries on in its own prose. */
function headOf(h) {
  const m = h.match(/^(.+?)(?: - | \(|: |, )/);
  return m ? m[1] : null;
}

/** Does normalised cite `c` name normalised heading `h`?  "strong" | "weak" | null.
 *  strong: the heading starts with the cite; the cite runs on past the whole heading or
 *  past its lead clause; or the cite's own first clause (before `,` / `:`, ≥12 chars) is a
 *  word-boundary prefix of the heading ("calibrate an exposure report, and i said so").
 *  weak: the two share a word-boundary prefix of ≥2 words and ≥16 chars and then diverge
 *  ("paddle-verified pages rather than…" vs "paddle-verified pages are frozen…") — reported
 *  as its own class so a reader can audit it, never folded into `resolved`. */
export function headingMatches(c, h, raw) {
  if (!c || !h) return null;
  if (h.startsWith(c) && !/^[\p{L}\p{N}]/u.test(h.slice(c.length))) return "strong";
  if (runsOnPast(c, h) || runsOnPast(c, headOf(h))) return "strong";
  const clause = c.match(/^(.+?)[,:]/)?.[1];
  if (clause && clause.length >= LONG_HEADING && h.startsWith(clause) && !/^[\p{L}\p{N}]/u.test(h.slice(clause.length))) {
    return "strong";
  }
  let i = 0;
  while (i < c.length && c[i] === h[i]) i++;
  let common = c.slice(0, i);
  if (/[\p{L}\p{N}]/u.test(c.charAt(i)) || /[\p{L}\p{N}]/u.test(h.charAt(i))) common = common.replace(/\S*$/u, "");
  common = common.trim();
  if (common.length >= 16 && common.split(" ").length >= 2) return "weak";
  // The RAW cite opens with an ALLCAPS run of >= 2 words that is a word-boundary prefix of the
  // heading, then carries on in lower-case prose ("FOUR GIT PROBES was itself inverted"): weak.
  const run = raw && raw.replace(/^[^A-Za-z0-9]+/, "").replace(/`/g, "").match(/^[A-Z0-9][A-Z0-9'’-]*(?: [A-Z0-9][A-Z0-9'’-]*)+(?=$| [a-z]|[,:;])/)?.[0];
  if (run) {
    const r = norm(run);
    if (r.length >= 8 && h.startsWith(r) && !/^[\p{L}\p{N}]/u.test(h.slice(r.length))) return "weak";
  }
  return null;
}

/** Best match of cite `cn` over a list of raw headings: "strong" beats "weak". */
function bestMatch(cn, headings, raw) {
  let weak = false;
  for (const h of headings) {
    const m = headingMatches(cn, norm(h), raw);
    if (m === "strong") return "strong";
    if (m === "weak") weak = true;
  }
  return weak ? "weak" : null;
}

// -------------------------------------------------------------- extraction

const PATH_CHARS = "[\\w.~/+@-]";
// group 1: opening backtick? 2: path  3: closing backtick? 4: rest-marker
const CITE_RE = new RegExp(
  `(?<![\\w./~+@-])(\`?)(${PATH_CHARS}*?[\\w-]\\.md)(?![\\w])(\`?\\)?)(?:(\\s{0,2})(§)|:(\\d+(?:-\\d+)?)(?!\\d))`,
  "g",
);

/** Take the cited heading text from `rest` (the text after `§` and its spaces). */
export function takeText(rest, insideBackticks) {
  // A cite whose text is itself emphasised (`§ *Heading*`, `§ **HEADING**`): take the span —
  // `*` is a terminator below, so without this the text is empty and the cite is dropped.
  const em = rest.match(/^(\*\*?)(?=\S)/);
  if (em) {
    const end = rest.indexOf(em[1], em[1].length);
    if (end > em[1].length) return takeText(rest.slice(em[1].length, end), insideBackticks);
  }
  const q = rest.charAt(0);
  const closer = { '"': '"', "“": "”", "'": "'", "‘": "’" }[q];
  if (closer) {
    const end = rest.indexOf(closer, 1);
    if (end > 1) return rest.slice(1, end);
  }
  let out = "";
  let i = 0;
  while (i < rest.length) {
    const ch = rest[i];
    const two = rest.slice(i, i + 2);
    const three = rest.slice(i, i + 3);
    if (three === " — " || three === " – " || three === " --" || two === " (") break;
    if (three === " · " || three === " §" || rest.startsWith(" and §", i)) break; // a chained second cite
    if (ch === ";" || ch === ")" || ch === "|" || ch === "*") break;
    if (ch === "." && (i + 1 >= rest.length || /\s/.test(rest[i + 1]))) break;
    if (ch === "," && /^,\s*`/.test(rest.slice(i))) break;
    if (ch === "`") {
      if (insideBackticks) break;
      const close = rest.indexOf("`", i + 1);
      if (close < 0) break;
      const span = rest.slice(i + 1, close);
      if (/\.md\b/.test(span) || span.includes("/")) break; // another file cite starts here
      out += rest.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/^["'“‘]+|["'”’]+$/g, "").replace(/[\s.,:;!?'"—–-]+$/u, "").trim();
}

export function extractCites(lines, fenced) {
  const cites = [];
  lines.forEach((line, idx) => {
    if (!line.includes(".md")) return;
    CITE_RE.lastIndex = 0;
    let m;
    while ((m = CITE_RE.exec(line))) {
      const [, open, name, close, , sect, lineNo] = m;
      const base = { line: idx + 1, name, fenced: !!fenced[idx] };
      if (lineNo !== undefined) {
        cites.push({ ...base, kind: "line", text: lineNo });
        continue;
      }
      if (!sect) continue;
      const insideBackticks = open === "`" && !close.startsWith("`");
      const after = line.slice(m.index + m[0].length).replace(/^\s+/, "");
      if (/^\d/.test(after) && !/^\d{4}-\d{2}-\d{2}/.test(after)) {
        cites.push({ ...base, kind: "numbered", text: (after.match(/^[\w.]+/) || [""])[0] });
        continue;
      }
      if (after.startsWith("§")) continue; // `§§` range notation
      const text = takeText(after, insideBackticks);
      if (!norm(text)) continue;
      // `§ X`, `§ N`, `§ <heading>`, `§ …`: prose ABOUT the cite form, not a cite.
      if (/^(?:[XYZN]\b(?!['\u2019-])|<[^>]*>|\.\.\.|\u2026|\()/u.test(after.replace(/^["'\u201C`]+/, ""))) {
        cites.push({ ...base, kind: "placeholder", text });
        continue;
      }
      cites.push({ ...base, kind: "section", text });
    }
  });
  return cites;
}

// -------------------------------------------------------------- resolution

function makeResolver(root, corpus) {
  const byBase = new Map();
  for (const f of corpus) {
    const b = path.posix.basename(f);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const corpusSet = new Set(corpus);
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const vendorRoot = path.join(root, VENDOR_DOCS);
  const vendorPresent = isDir(vendorRoot);
  let vendor = null;
  /** Vendored doc paths relative to the docs ROOT (so `docs/x.md` can never match the root's own
   *  name), plus a basename index. Walked once, on first need. */
  const vendorDocs = () => {
    if (vendor) return vendor;
    vendor = { byBase: new Map(), rels: [] };
    const found = [];
    walk(vendorRoot, found);
    for (const a of found) {
      const r = path.relative(vendorRoot, a).split(path.sep).join("/");
      vendor.rels.push(r);
      const b = path.posix.basename(r);
      if (!vendor.byBase.has(b)) vendor.byBase.set(b, `${VENDOR_DOCS}/${r}`);
    }
    vendor.rels.sort();
    return vendor;
  };
  const stripOrder = (seg) => seg.replace(/^\d+-/, "");
  /** A directory-prefixed name whose segments are the LAST segments of a vendored path, each
   *  compared with the `NN-` ordering prefix stripped. */
  const vendorSuffix = (name) => {
    const segs = name.split("/").filter((s) => s && s !== ".").map(stripOrder);
    if (segs.length < 2 || segs.includes("..")) return null;
    for (const r of vendorDocs().rels) {
      const vs = r.split("/").map(stripOrder);
      if (vs.length < segs.length) continue;
      const off = vs.length - segs.length;
      if (segs.every((s, i) => s === vs[off + i])) return `${VENDOR_DOCS}/${r}`;
    }
    return null;
  };
  /** Without the vendored docs, could this unresolved name have been one? A path into a dot-dir
   *  or an existing root directory cannot (it was already looked up where it says it lives). */
  const couldBeVendored = (name) => {
    if (!name.includes("/")) return true;
    const first = name.replace(/^(\.\/)+/, "").split("/")[0];
    return !first.startsWith(".") && !isDir(path.join(root, first));
  };
  const unchecked = { status: "out-of-corpus", unchecked: true };
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  function resolve(name, citingFile) {
    if (name.startsWith("~") || /^https?:/.test(name)) return { status: "external" };
    if (name.includes("/")) {
      const cands = [path.join(root, name), path.join(root, path.dirname(citingFile), name)];
      for (const c of cands) {
        const r = rel(path.resolve(c));
        if (r.startsWith("..")) continue;
        if (corpusSet.has(r)) return { status: "ok", file: r };
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return { status: "out-of-corpus", file: r };
      }
      const clean = name.replace(/^(\.\/)+/, "");
      const suffix = corpus.filter((f) => f === clean || f.endsWith("/" + clean));
      if (suffix.length === 1) return { status: "ok", file: suffix[0] };
      if (suffix.length > 1) return { status: "ambiguous", candidates: suffix };
      if (!vendorPresent) return couldBeVendored(name) ? unchecked : { status: "file-missing" };
      const vendored = vendorSuffix(clean);
      if (vendored) return { status: "out-of-corpus", file: vendored };
      return { status: "file-missing" };
    }
    const hits = byBase.get(name) || [];
    if (hits.length === 1) return { status: "ok", file: hits[0] };
    if (hits.length > 1) return { status: "ambiguous", candidates: hits };
    // A bare name outside the corpus: one existence check each at the root and in the
    // flat out-of-corpus homes (no listing, no read), then the vendored framework docs.
    for (const d of ["", ...OUT_OF_CORPUS_FLAT]) {
      const relName = path.posix.join(d, name);
      if (fs.existsSync(path.join(root, relName))) return { status: "out-of-corpus", file: relName };
    }
    if (!vendorPresent) return unchecked;
    const vendored = vendorDocs().byBase.get(name);
    if (vendored) return { status: "out-of-corpus", file: vendored };
    return { status: "file-missing" };
  }
  resolve.vendorPresent = vendorPresent;
  return resolve;
}

/** The candidate nearest the citing file: walk up from its directory, first ancestor holding a
 *  candidate wins (a skill's `references/x.md` citing `SKILL.md` lands on that skill's SKILL.md). */
export function ownDirCandidate(citingFile, candidates) {
  let d = path.posix.dirname(citingFile);
  for (;;) {
    const hit = candidates.find((c) => path.posix.dirname(c) === d);
    if (hit) return hit;
    if (d === "." || d === "/" || d === "") return null;
    d = path.posix.dirname(d);
  }
}

// --------------------------------------------------------------------- run

export function scan(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`root not a directory: ${root}`);
  const corpus = listCorpus(root);
  const parsed = new Map();
  const get = (f) => {
    if (!parsed.has(f)) parsed.set(f, parseFile(fs.readFileSync(path.join(root, f), "utf8")));
    return parsed.get(f);
  };
  const resolve = makeResolver(root, corpus);
  const corpusSet = new Set(corpus);
  /** Classify normalised cite `cn` (raw `raw`) against ONE corpus file: headings, then bold
   *  run-ins, then the file's declared redirects (ALIASES), then the weak-prefix test. Both the
   *  single-file path and the ambiguous path (tie-break and `holding`) go through this. */
  const classifyIn = (cn, raw, file) => {
    const t = get(file);
    const onHeading = bestMatch(cn, t.headings, raw);
    if (onHeading === "strong") return { class: "resolved", target: file };
    const onBold = bestMatch(cn, t.bolds, raw);
    if (onBold === "strong") return { class: "bold-heading", target: file };
    // ALIASES is keyed by repo-relative path, so the redirect applies only to the declaring
    // file itself; adding the next relocation is one ALIASES entry.
    const aliasHits = (ALIASES[file] || [])
      .filter((a) => corpusSet.has(a))
      .map((a) => [a, bestMatch(cn, [...get(a).headings, ...get(a).bolds], raw)]);
    const strongAlias = aliasHits.find(([, m]) => m === "strong");
    if (strongAlias) return { class: "alias", target: strongAlias[0] };
    if (onHeading === "weak" || onBold === "weak" || aliasHits.some(([, m]) => m === "weak")) {
      return { class: "weak-prefix", target: file };
    }
    return { class: "heading-missing", target: file };
  };
  const findings = [];
  for (const f of corpus) {
    const { lines, fenced } = get(f);
    const history = isHistoryFile(f);
    for (const c of extractCites(lines, fenced)) {
      const rec = { file: f, line: c.line, name: c.name, text: c.text, fenced: c.fenced, history };
      if (c.kind === "line") {
        findings.push({ ...rec, class: "line-cite" });
        continue;
      }
      if (c.kind === "numbered" || c.kind === "placeholder") {
        findings.push({ ...rec, class: c.kind });
        continue;
      }
      // A `## from <file> § X` heading records where the text below it came from.
      if (!c.fenced && PROVENANCE.test(lines[c.line - 1])) {
        findings.push({ ...rec, class: "provenance" });
        continue;
      }
      const r = resolve(c.name, f);
      if (r.status === "external" || r.status === "file-missing") {
        const upstream = r.status === "file-missing" && UPSTREAM_CITER.test(f) && !c.name.startsWith(".");
        findings.push({ ...rec, class: upstream ? "upstream" : r.status });
        continue;
      }
      if (r.status === "out-of-corpus") {
        findings.push(r.unchecked ? { ...rec, class: "out-of-corpus", unchecked: true } : { ...rec, class: "out-of-corpus", target: r.file });
        continue;
      }
      const cn = norm(c.text);
      if (r.status === "ambiguous") {
        const own = ownDirCandidate(f, r.candidates);
        if (own) {
          const k = classifyIn(cn, c.text, own);
          if (STRONG.has(k.class)) {
            findings.push({ ...rec, class: "resolved", target: k.target, tieBreak: { over: r.candidates.length, via: k.class } });
            continue;
          }
        }
        const holding = r.candidates.filter((cand) => STRONG.has(classifyIn(cn, c.text, cand).class));
        findings.push({ ...rec, class: "ambiguous", candidates: r.candidates, holding });
        continue;
      }
      findings.push({ ...rec, ...classifyIn(cn, c.text, r.file) });
    }
  }
  return { corpusFiles: corpus.length, findings, vendorPresent: resolve.vendorPresent };
}

const ALL_CLASSES = [
  "heading-missing",
  "file-missing",
  "ambiguous",
  "resolved",
  "bold-heading",
  "alias",
  "weak-prefix",
  "provenance",
  "upstream",
  "out-of-corpus",
  "external",
  "numbered",
  "placeholder",
  "line-cite",
];

/** The run's exit code: 1 iff a FAILING class is present in a LIVE file (`counts` holds live
 *  findings only; history findings sit in `historyCounts`) — the one spelling of "fails". */
export function exitCode(sum) {
  return [...FAILING].some((c) => sum.counts[c] > 0) ? 1 : 0;
}

export function summarise(res) {
  const zero = () => Object.fromEntries(ALL_CLASSES.map((c) => [c, 0]));
  const counts = zero();
  const historyCounts = zero();
  const historyFiles = new Set();
  for (const f of res.findings) {
    if (f.history) {
      historyCounts[f.class]++;
      historyFiles.add(f.file);
    } else counts[f.class]++;
  }
  const deadByFile = new Map();
  for (const f of res.findings) {
    if (!isFailing(f)) continue;
    deadByFile.set(f.file, (deadByFile.get(f.file) || 0) + 1);
  }
  const topDeadFiles = [...deadByFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  return {
    corpusFiles: res.corpusFiles,
    total: res.findings.length,
    counts,
    historyCounts,
    historyTotal: res.findings.filter((f) => f.history).length,
    historyFiles: historyFiles.size,
    failing: res.findings.filter(isFailing).length,
    tieBreak: res.findings.filter((f) => f.tieBreak && !f.history).length,
    vendorPresent: res.vendorPresent !== false,
    unchecked: res.findings.filter((f) => f.unchecked).length,
    topDeadFiles,
  };
}

function fmt(f) {
  const sep = f.class === "line-cite" ? ":" : " § ";
  let s = `${f.file}:${f.line}  ${f.history ? "history:" : ""}${f.class}  ${f.name}${sep}${f.text}`;
  if (f.candidates) {
    const list = f.candidates.length <= 5 ? f.candidates.join(", ") : `${f.candidates.length} files named ${path.posix.basename(f.candidates[0])}`;
    s += `  -> ${list}  (heading in: ${f.holding.length ? f.holding.join(", ") : "none of them"})`;
  } else if (f.target) s += `  -> ${f.target}`;
  if (f.tieBreak) s += `  (own-dir tie-break over ${f.tieBreak.over} candidates, via ${f.tieBreak.via})`;
  if (f.unchecked) s += "  (unchecked: vendored docs not present)";
  if (f.fenced) s += "  [fenced]";
  return s;
}

function report(res, { all, quiet, json }) {
  const sum = summarise(res);
  // quiet: the failing set only. default: dead classes, live first then history. all: everything.
  const pick = (f) => (quiet ? isFailing(f) : all || DEAD_CLASSES.includes(f.class));
  const shown = [];
  for (const hist of [false, true]) {
    for (const cls of all ? ALL_CLASSES : DEAD_CLASSES) {
      for (const f of res.findings) if (!!f.history === hist && f.class === cls && pick(f)) shown.push(f);
    }
  }
  if (json) {
    console.log(JSON.stringify({ summary: sum, findings: shown }, null, 2));
    return sum;
  }
  for (const f of shown) console.log(fmt(f));
  if (shown.length) console.log("");
  const c = sum.counts;
  const h = sum.historyCounts;
  console.log(
    `section-cite-check: ${sum.corpusFiles} corpus files · ${sum.total} cites scanned (${sum.historyTotal} in ${sum.historyFiles} history files) · live: ` +
      `resolved ${c.resolved} (own-dir tie-break ${sum.tieBreak}) · resolved-via-bold ${c["bold-heading"]} · alias ${c.alias} · weak-prefix ${c["weak-prefix"]} · ` +
      `provenance ${c.provenance} · upstream ${c.upstream} · out-of-corpus ${c["out-of-corpus"]} · external ${c.external} · numbered ${c.numbered} · placeholder ${c.placeholder} · line-cite ${c["line-cite"]}`,
  );
  console.log(
    `failing (live files): heading-missing ${c["heading-missing"]} · file-missing ${c["file-missing"]} · total ${sum.failing}  |  ambiguous ${c.ambiguous} (does not fail)`,
  );
  console.log(
    `history (never fails): heading-missing ${h["heading-missing"]} · file-missing ${h["file-missing"]} · ambiguous ${h.ambiguous} · ` +
      `weak-prefix ${h["weak-prefix"]} · provenance ${h.provenance} · resolved ${h.resolved + h["bold-heading"] + h.alias} · line-cite ${h["line-cite"]}`,
  );
  if (!sum.vendorPresent) {
    console.log(`warning: vendored docs not present (${VENDOR_DOCS}); ${sum.unchecked} cites could not be checked (out-of-corpus, unchecked)`);
  }
  if (!quiet && sum.topDeadFiles.length) {
    console.log("top citing files (failing: heading-missing + file-missing in live files):");
    for (const [f, n] of sum.topDeadFiles) console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
  return sum;
}

// --------------------------------------------------------------- self-test

function selfTest() {
  let failures = 0;
  const ok = (label, cond, detail = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  ${detail}`}`);
    if (!cond) failures++;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-"));
  try {
    const w = (rel, body) => {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    };
    w(
      ".claude/rules/alpha.md",
      [
        "# Alpha rules",
        "## ⛔ **READ COUNTS**, NEVER A PIPED `EXIT` CODE — and more",
        "## Commands",
        "### Process",
        "## Shared vocabulary of the corpus",
        "## THE RETURN CONTRACT — refresh and re-catalog seats",
        "### CALIBRATE AN EXPOSURE REPORT TO WHERE THE VALUE LIVES",
        "### PADDLE-VERIFIED PAGES ARE FROZEN ON TERMS",
        "### SIZE A RAISE TO ABSORB THE ROUND",
        "## 2026-09-02 — a dated archive heading",
        "**BOLD RUN-IN HEADING.** body text",
        "⛔ **ONE EXCEPTION — the memory read.** body",
        "```bash",
        "# Fenced fake heading",
        "```",
        "",
      ].join("\n"),
    );
    w(".claude/skills/one/SKILL.md", "# One\n## Shared heading\n");
    w(".claude/skills/two/SKILL.md", "# Two\n## Other heading\n");
    w(".claude/skills/one/references/notes.md", "# Notes\n## Directory relative target\n");
    w(".claude/orchestrator/conventions.md", "# Conventions\n## Moved section of conventions\n**A handoff's STATE-CLAIM is a SNAPSHOT:** body\n");
    w("AGENTS.md", "# AGENTS.md\nPointers of the form AGENTS.md § X resolve in conventions.\n");
    w("plans/outside.md", "# Outside\n");
    w(".claude/project-memory/memory-only.md", "# Memory only\n");
    // The vendored framework docs, PRESENT in this fixture (the absent case is its own fixture).
    w("node_modules/next/dist/docs/01-app/03-api-reference/02-route-segment-config/maxDuration.md", "# maxDuration\n");
    w("node_modules/next/dist/docs/01-app/vendored-only.md", "# Vendored only\n");

    // [expected class, citing line] — one cite per line, line numbers derived.
    const cases = [
      ["resolved", "Emphasis + symbol: `alpha.md` § READ COUNTS, NEVER A PIPED EXIT CODE. Then prose."],
      ["resolved", "First clause only: `alpha.md` § READ COUNTS — the rest of the sentence."],
      ["resolved", "Cite runs past a long heading: `alpha.md` § Shared vocabulary of the corpus applies here"],
      ["resolved", "Root path: `.claude/rules/alpha.md` § Commands"],
      ["resolved", "Quoted: `alpha.md` § \"Commands\" was the name."],
      ["resolved", "Inside backticks: `alpha.md § Commands` here."],
      ["resolved", "Bare form: alpha.md § Commands; then more."],
      ["resolved", "Short heading, punctuation boundary: `alpha.md` § Process, step 1b, the scan"],
      ["resolved", "Dated heading: `alpha.md` § 2026-09-02"],
      ["resolved", "Path suffix: `one/references/notes.md` § Directory relative target"],
      ["resolved", "Lead clause of a long heading, then prose: `alpha.md` § THE RETURN CONTRACT as well"],
      ["resolved", "Cite's own first clause: `alpha.md` § CALIBRATE AN EXPOSURE REPORT, and I said so"],
      ["resolved", "Short heading, step-shaped token: `alpha.md` § Process 4b"],
      ["resolved", "Markdown link form: [`alpha.md`](alpha.md) § Commands"],
      ["resolved", "Italic-wrapped cite text: `alpha.md` § *Commands* and prose"],
      ["resolved", "Bold-wrapped cite text: `alpha.md` § **Commands** here"],
      ["weak-prefix", "Shared 16-char prefix, then diverges: `alpha.md` § PADDLE-VERIFIED PAGES rather than a paraphrase"],
      ["weak-prefix", "ALLCAPS lead quoted, then prose: `alpha.md` § SIZE A RAISE names the fold"],
      ["resolved", "Chained second cite ends the first: `alpha.md` § Commands and § Process"],
      ["heading-missing", "NEG part of a word is not a heading: `alpha.md` § Comm"],
      ["heading-missing", "NEG two shared words are not enough: `alpha.md` § THE RETURN POLICY of old"],
      ["bold-heading", "Bold run-in: `alpha.md` § BOLD RUN-IN HEADING (its note)."],
      ["bold-heading", "Bold run-in behind a symbol: `alpha.md` § ONE EXCEPTION carries the rule"],
      ["alias", "Redirect onto a bold run-in: `AGENTS.md` § a handoff's state-claim is a snapshot"],
      ["placeholder", "No heading named: `AGENTS.md` § (3,656 chars, five sections)"],
      ["out-of-corpus", "Bare name in the project-memory home: `memory-only.md` § Anything"],
      ["numbered", "Numbered: `alpha.md` § 2 and more"],
      ["numbered", "Numbered tight: `alpha.md` §4A)"],
      ["line-cite", "Line cite in backticks: `alpha.md:12`"],
      ["line-cite", "Line cite bare: see alpha.md:40 for it"],
      ["ambiguous", "Bare basename, two files: `SKILL.md` § Shared heading"],
      ["alias", "Declared redirect: `AGENTS.md` § Moved section of conventions"],
      ["out-of-corpus", "Outside the corpus: `plans/outside.md` § Anything at all"],
      ["external", "Home path: `~/.claude/x.md` § Whatever"],
      ["heading-missing", "NEG dead heading: `alpha.md` § NO SUCH HEADING HERE"],
      ["heading-missing", "NEG a heading starting with A is not a placeholder: `alpha.md` § A missing rule here"],
      ["heading-missing", "NEG short heading needs a boundary: `alpha.md` § Processing stuff"],
      ["heading-missing", "NEG short heading then a plain word: `alpha.md` § Commands index of old"],
      ["heading-missing", "NEG a fenced # line is not a heading: `alpha.md` § Fenced fake heading"],
      ["heading-missing", "NEG AGENTS.md without the moved text: `AGENTS.md` § Never moved anywhere"],
      ["file-missing", "NEG dead file: `ghost.md` § Whatever"],
      ["file-missing", "NEG dead dir path: `.claude/rules/gone.md` § Commands"],
      ["out-of-corpus", "Vendored, dir prefix, ordering prefixes stripped: `route-segment-config/maxDuration.md` § Server Actions"],
      ["out-of-corpus", "Vendored, three segments: `03-api-reference/route-segment-config/maxDuration.md` § Server Actions"],
      ["out-of-corpus", "Vendored, bare basename: `vendored-only.md` § Anything"],
      ["file-missing", "NEG vendored basename under the wrong directory: `wrong-config/maxDuration.md` § Server Actions"],
      ["file-missing", "NEG the docs root's own name is not a vendored segment: `docs/vendored-only.md` § Anything"],
    ];
    const fencedCase = ["resolved", "inside a fence: `alpha.md` § Commands"];
    const body = ["# Cites", ...cases.map((c) => c[1]), "```", fencedCase[1], "```", ""];
    w(".claude/docs/cites.md", body.join("\n"));
    // Directory-relative cite from a skill file (the citing file's own directory).
    w(".claude/skills/one/SKILL.md", "# One\n## Shared heading\nSee `references/notes.md` § Directory relative target.\n");

    const res = scan(dir);
    const inCites = res.findings.filter((f) => f.file === ".claude/docs/cites.md");
    cases.forEach(([want, text], i) => {
      const got = inCites.filter((f) => f.line === i + 2);
      ok(`${want.padEnd(15)} ${text.slice(0, 70)}`, got.length === 1 && got[0].class === want, `got ${JSON.stringify(got.map((g) => [g.class, g.text]))}`);
    });
    const fl = cases.length + 3;
    const fc = inCites.filter((f) => f.line === fl);
    ok("fenced cite is extracted and flagged", fc.length === 1 && fc[0].class === "resolved" && fc[0].fenced === true, JSON.stringify(fc));
    const dr = res.findings.filter((f) => f.file === ".claude/skills/one/SKILL.md");
    ok("directory-relative cite resolves against the citing file's dir", dr.length === 1 && dr[0].class === "resolved" && dr[0].target === ".claude/skills/one/references/notes.md", JSON.stringify(dr));
    const amb = inCites.find((f) => f.class === "ambiguous");
    ok("ambiguous lists both candidates and names the one holding the heading", amb && amb.candidates.length === 2 && amb.holding.length === 1, JSON.stringify(amb));
    const sum = summarise(res);
    ok("summary: 4 file-missing", sum.counts["file-missing"] === 4, JSON.stringify(sum.counts));
    const vend = inCites.filter((f) => f.class === "out-of-corpus" && f.target?.startsWith(VENDOR_DOCS));
    ok("vendored cites name the vendored file they resolved to", vend.length === 3 && vend.some((f) => f.target.endsWith("02-route-segment-config/maxDuration.md")), JSON.stringify(vend.map((f) => f.target)));
    ok("vendored docs present: the run reports none unchecked", sum.vendorPresent === true && sum.unchecked === 0, JSON.stringify({ v: sum.vendorPresent, u: sum.unchecked }));
    ok("summary: 8 heading-missing", sum.counts["heading-missing"] === 8, JSON.stringify(sum.counts));
    ok("summary: 19 resolved (17 + fenced + dir-relative)", sum.counts.resolved === 19, JSON.stringify(sum.counts));
    const zero = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0]));
    ok("exit code: 1 on this fixture, 0 on a clean count, 0 on ambiguous alone, 0 on weak-prefix alone", exitCode(sum) === 1 && exitCode({ counts: zero }) === 0 && exitCode({ counts: { ...zero, ambiguous: 3 } }) === 0 && exitCode({ counts: { ...zero, "weak-prefix": 3 } }) === 0, JSON.stringify(sum.counts));
    ok("summary total = every cite in the fixture", sum.total === cases.length + 3, `total=${sum.total}`);
    const ph = res.findings.filter((f) => f.file === "AGENTS.md");
    ok("a placeholder cite (AGENTS.md § X) is its own class, not a dead heading", ph.length === 1 && ph[0].class === "placeholder", JSON.stringify(ph));
    ok("the project-memory home is probed, never scanned as corpus", !res.findings.some((f) => f.file.startsWith(".claude/project-memory/")), "a project-memory file was scanned");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // A non-root redirect is one ALIASES entry (keys are repo-relative paths).
  const ad = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-alias-"));
  try {
    fs.mkdirSync(path.join(ad, ".claude/rules"), { recursive: true });
    fs.mkdirSync(path.join(ad, ".claude/traps"), { recursive: true });
    fs.writeFileSync(path.join(ad, ".claude/rules/old.md"), "# Old\nSee `.claude/rules/old.md` § Moved trap entry.\n");
    fs.writeFileSync(path.join(ad, ".claude/traps/new.md"), "# New\n## Moved trap entry\n");
    ALIASES[".claude/rules/old.md"] = [".claude/traps/new.md"]; // a fixture-only entry, removed below
    const ar = scan(ad).findings;
    ok("a non-root ALIASES key redirects its own file", ar.length === 1 && ar[0].class === "alias", JSON.stringify(ar));
  } finally {
    delete ALIASES[".claude/rules/old.md"];
    fs.rmSync(ad, { recursive: true, force: true });
  }
  const cli = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: "utf8" });
  const run = (args) => cli(args).status;
  const mk = (root) => (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  // History partition, provenance headers, the ambiguous tie-break, and --quiet.
  const hd = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-hist-"));
  try {
    const w = mk(hd);
    w("node_modules/next/dist/docs/index.md", "# Docs\n");
    w(".claude/rules/target.md", "# Target\n## Real heading\n**Bold run-in only.** body\n");
    w(".claude/skills/one/SKILL.md", "# One\n## Own heading\n**Own bold run-in.** body\n");
    w(".claude/skills/two/SKILL.md", "# Two\n## Other heading\n");
    // [file, expected class, history?, citing line] — one cite per file line 2.
    const hc = [
      [".claude/skills/one/MEMORY.md", "heading-missing", true, "Dead in the live MEMORY router: `target.md` § No such heading"],
      [".claude/skills/one/MEMORY-ARCHIVE-2026-01-01-2026-02-01.md", "heading-missing", true, "Dead in a shard: `target.md` § No such heading"],
      [".claude/skills/one/CHANGELOG-ARCHIVE-2026.md", "heading-missing", true, "Dead in a changelog shard: `target.md` § No such heading"],
      [".claude/docs/rules-ARCHIVE/x-cases.md", "file-missing", true, "Dead file in the rules archive: `.claude/rules/gone.md` § Anything"],
      [".claude/skills/one/notes-MEMORY.md", "heading-missing", false, "NEG MEMORY not at the start of the basename is live: `target.md` § No such heading"],
      [".claude/docs/rules-ARCHIVE-old.md", "heading-missing", false, "NEG a sibling of the archive dir is live: `target.md` § No such heading"],
      [".claude/traps/p2.md", "provenance", false, "## from `target.md` § Gone section — parked"],
      [".claude/traps/p3.md", "provenance", false, "### from `target.md` § Also gone"],
      [".claude/traps/p4.md", "heading-missing", false, "#### from `target.md` § Four hashes is not a provenance header"],
      [".claude/traps/p5.md", "heading-missing", false, "Prose taken from `target.md` § Gone section is not a header"],
      [".claude/traps/p6.md", "heading-missing", false, "## Notes from `target.md` § Gone, the heading does not OPEN with from"],
      [".claude/traps/p7.md", "provenance", false, "## from `target.md` § Real heading (a header, so provenance even when the section exists)"],
      [".claude/skills/one/references/r1.md", "resolved", false, "Own skill's SKILL.md, heading: `SKILL.md` § Own heading"],
      [".claude/skills/one/references/r2.md", "resolved", false, "Own skill's SKILL.md, bold run-in: `SKILL.md` § Own bold run-in"],
      [".claude/skills/one/r3.md", "resolved", false, "Same directory: `SKILL.md` § Own heading"],
      [".claude/skills/one/references/r4.md", "ambiguous", false, "NEG only in ANOTHER skill's SKILL.md: `SKILL.md` § Other heading"],
      [".claude/rules/r5.md", "ambiguous", false, "NEG no own-dir candidate: `SKILL.md` § Own bold run-in"],
      [".claude/skills/one/references/r6.md", "ambiguous", false, "NEG in no candidate at all: `SKILL.md` § Nowhere at all"],
      [".claude/skills/one/references/MEMORY.md", "resolved", true, "History tie-break: `SKILL.md` § Own heading"],
    ];
    for (const [file, , , text] of hc) w(file, `# ${path.posix.basename(file)}\n${text}\n`);
    w(".claude/traps/p8.md", "# p8\n```\n## from `target.md` § Fenced gone\n```\n");
    const hr = scan(hd);
    for (const [file, want, hist, text] of hc) {
      const got = hr.findings.filter((f) => f.file === file);
      ok(
        `${(hist ? "history:" : "") + want} ${text.slice(0, 60)}`,
        got.length === 1 && got[0].class === want && got[0].history === hist,
        `got ${JSON.stringify(got.map((g) => [g.class, g.history, g.text]))}`,
      );
    }
    const p8 = hr.findings.filter((f) => f.file === ".claude/traps/p8.md");
    ok("NEG a fenced `## from` line is not a provenance header", p8.length === 1 && p8[0].class === "heading-missing", JSON.stringify(p8));
    const tb = hr.findings.filter((f) => f.tieBreak);
    ok(
      "tie-break names the citing skill's own SKILL.md, via the shared matcher (heading AND bold run-in)",
      tb.length === 4 && tb.every((f) => f.target === ".claude/skills/one/SKILL.md") && tb.some((f) => f.tieBreak.via === "bold-heading"),
      JSON.stringify(tb.map((f) => [f.file, f.target, f.tieBreak])),
    );
    const r5 = hr.findings.find((f) => f.file === ".claude/rules/r5.md");
    ok("ambiguous `holding` uses the shared matcher (a bold run-in counts)", r5 && r5.holding.length === 1 && r5.holding[0] === ".claude/skills/one/SKILL.md", JSON.stringify(r5));
    const hs = summarise(hr);
    ok("history findings sit in historyCounts, never in the live counts", hs.historyCounts["heading-missing"] === 3 && hs.historyCounts["file-missing"] === 1 && hs.counts["file-missing"] === 0 && hs.historyTotal === 5, JSON.stringify({ c: hs.counts, h: hs.historyCounts }));
    ok("the summary's tie-break count is live-only (3 live, 1 in a history file)", hs.tieBreak === 3, JSON.stringify({ tieBreak: hs.tieBreak }));
    ok("provenance is counted and does not fail", hs.counts.provenance === 3 && !hr.findings.some((f) => f.class === "provenance" && isFailing(f)), JSON.stringify(hs.counts));
    ok("the failing set is the live dead cites only (6 heading-missing)", hs.failing === 6 && hs.counts["heading-missing"] === 6 && exitCode(hs) === 1, JSON.stringify(hs.counts));
    const zero = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0]));
    ok("exit 0 when every dead cite is in a history file", exitCode({ counts: zero, historyCounts: { ...zero, "heading-missing": 9, "file-missing": 2 } }) === 0, "");
    // --quiet prints exactly the failing set's lines, then the summary.
    const q = cli(["--quiet", "--dir", hd]);
    const out = q.stdout.split("\n");
    const blank = out.indexOf("");
    const listed = out.slice(0, blank);
    ok(
      "--quiet lists every failing finding with file:line, and nothing else before the summary",
      q.status === 1 && listed.length === 6 && listed.every((l) => / {2}heading-missing {2}/.test(l) && /^\S+:\d+ /.test(l)) && !q.stdout.includes("history:") && !q.stdout.includes("top citing files"),
      JSON.stringify({ rc: q.status, listed }),
    );
    ok("--quiet summary carries the history line", /^history \(never fails\): heading-missing 3 · file-missing 1/m.test(q.stdout), q.stdout);
    // A corpus whose ONLY dead cites are in history files exits 0.
    for (const f of [".claude/skills/one/notes-MEMORY.md", ".claude/docs/rules-ARCHIVE-old.md", ".claude/traps/p4.md", ".claude/traps/p5.md", ".claude/traps/p6.md", ".claude/traps/p8.md"]) fs.rmSync(path.join(hd, f));
    const q0 = cli(["--quiet", "--dir", hd]);
    ok("a corpus dead only in history files exits 0 under --quiet, listing nothing", q0.status === 0 && q0.stdout.startsWith("section-cite-check:"), JSON.stringify({ rc: q0.status, head: q0.stdout.slice(0, 80) }));
  } finally {
    fs.rmSync(hd, { recursive: true, force: true });
  }
  // Upstream paths in an external-* skill: counted, non-failing; a dot-path there and the same path elsewhere still fail.
  const xd = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-upstream-"));
  try {
    const w = mk(xd);
    w("node_modules/next/dist/docs/index.md", "# Docs\n");
    w(".claude/skills/external-x/notes.md", "# n\nUpstream: `docs/agents.md` § Model Selection Criteria\nNEG local dot-path: `.claude/rules/gone.md` § Anything\n");
    w(".claude/skills/externalx/notes.md", "# n\nNEG not an external-* skill: `docs/agents.md` § Model Selection Criteria\n");
    const xr = scan(xd);
    const cls = (file, line) => xr.findings.filter((f) => f.file === file && f.line === line).map((f) => f.class).join(",");
    ok("external-* skill: an upstream relative path is upstream", cls(".claude/skills/external-x/notes.md", 2) === "upstream", cls(".claude/skills/external-x/notes.md", 2));
    ok("NEG external-* skill: a dot-path is still file-missing", cls(".claude/skills/external-x/notes.md", 3) === "file-missing", cls(".claude/skills/external-x/notes.md", 3));
    ok("NEG the same path outside external-* is file-missing", cls(".claude/skills/externalx/notes.md", 2) === "file-missing", cls(".claude/skills/externalx/notes.md", 2));
    ok("upstream does not fail the run", exitCode(summarise({ ...xr, findings: xr.findings.filter((f) => f.class === "upstream") })) === 0 && summarise(xr).counts.upstream === 1, "");
  } finally {
    fs.rmSync(xd, { recursive: true, force: true });
  }
  // Vendored docs ABSENT: a cite that needed them is out-of-corpus + unchecked, never file-missing.
  const vd = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-novendor-"));
  try {
    const w = mk(vd);
    w(".claude/rules/target.md", "# Target\n## Real heading\n");
    w("plans/keep.md", "# keep\n");
    w(
      ".claude/rules/a.md",
      [
        "# a",
        "Dir-prefixed: `route-segment-config/maxDuration.md` § Server Actions",
        "Bare: `ghost.md` § Whatever",
        "NEG a dot-dir path is still checked: `.claude/rules/gone.md` § Anything",
        "NEG an existing root dir is still checked: `plans/gone.md` § Anything",
        "Corpus cite still resolves: `target.md` § Real heading",
        "",
      ].join("\n"),
    );
    const vr = scan(vd);
    const at = (n) => vr.findings.filter((f) => f.line === n && f.file === ".claude/rules/a.md");
    ok("no vendor: a dir-prefixed miss is out-of-corpus + unchecked", at(2).length === 1 && at(2)[0].class === "out-of-corpus" && at(2)[0].unchecked === true, JSON.stringify(at(2)));
    ok("no vendor: a bare miss is out-of-corpus + unchecked", at(3).length === 1 && at(3)[0].class === "out-of-corpus" && at(3)[0].unchecked === true, JSON.stringify(at(3)));
    ok("no vendor: a dot-dir path still reads file-missing", at(4).length === 1 && at(4)[0].class === "file-missing", JSON.stringify(at(4)));
    ok("no vendor: an existing-root-dir path still reads file-missing", at(5).length === 1 && at(5)[0].class === "file-missing", JSON.stringify(at(5)));
    ok("no vendor: a corpus cite still resolves", at(6).length === 1 && at(6)[0].class === "resolved", JSON.stringify(at(6)));
    const vq = cli(["--quiet", "--dir", vd]);
    ok(
      "no vendor: one warning line with the unchecked count",
      vq.stdout.split("\n").filter((l) => l.startsWith("warning: vendored docs not present")).length === 1 && /; 2 cites could not be checked/.test(vq.stdout) && vq.status === 1,
      JSON.stringify({ rc: vq.status, out: vq.stdout }),
    );
  } finally {
    fs.rmSync(vd, { recursive: true, force: true });
  }
  // Instrument failures exit 2 end-to-end: an unreadable corpus dir, and an empty root.
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "section-cite-check-unread-"));
  const udRules = path.join(ud, ".claude/rules");
  try {
    fs.mkdirSync(udRules, { recursive: true });
    fs.writeFileSync(path.join(udRules, "a.md"), "# A\n");
    fs.mkdirSync(path.join(ud, ".claude/skills"), { recursive: true });
    fs.writeFileSync(path.join(ud, ".claude/skills/clean.md"), "# Clean\n"); // the rest of the corpus is readable and clean
    fs.chmodSync(udRules, 0o000);
    const asRoot = process.getuid?.() === 0;
    let threw = false;
    try {
      scan(ud);
    } catch {
      threw = true;
    }
    ok("an unreadable corpus directory makes scan throw, never read clean", threw || asRoot, "scan returned");
    const rc = run(["--quiet", "--dir", ud]);
    ok("an unreadable corpus directory exits 2", rc === 2 || asRoot, `rc=${rc}`);
    fs.chmodSync(udRules, 0o755);
    fs.rmSync(path.join(ud, ".claude"), { recursive: true, force: true });
    const rcEmpty = run(["--quiet", "--dir", ud]);
    ok("an empty corpus exits 2 (no clean zero over nothing)", rcEmpty === 2, `rc=${rcEmpty}`);
  } finally {
    if (fs.existsSync(udRules)) fs.chmodSync(udRules, 0o755);
    fs.rmSync(ud, { recursive: true, force: true });
  }
  console.log(`\n${failures === 0 ? "SELF-TEST PASS" : `SELF-TEST FAIL (${failures})`}`);
  return failures === 0 ? 0 : 1;
}

// --------------------------------------------------------------------- CLI

function main() {
  const argv = process.argv.slice(2);
  const known = new Set(["--self-test", "--all", "--quiet", "--json", "--dir"]);
  for (let i = 0; i < argv.length; i++) {
    if (!known.has(argv[i])) {
      console.error(`section-cite-check: unknown argument ${argv[i]} (known: ${[...known].join(" ")})`);
      process.exit(2);
    }
    if (argv[i] === "--dir") i++;
  }
  if (argv.includes("--self-test")) process.exit(selfTest());
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // the repo this script lives in, never the cwd: run from outside it, cwd was ~/.claude (2026-10-11)
  const di = argv.indexOf("--dir");
  if (di >= 0) {
    if (!argv[di + 1]) {
      console.error("section-cite-check: --dir needs a path");
      process.exit(2);
    }
    root = path.resolve(argv[di + 1]);
  }
  let res;
  try {
    res = scan(root);
  } catch (e) {
    console.error(`section-cite-check: ${e.message}`);
    process.exit(2);
  }
  if (res.corpusFiles === 0) {
    console.error(`section-cite-check: no corpus files under ${root} — wrong --dir? (refusing to report a clean zero)`);
    process.exit(2);
  }
  const sum = report(res, { all: argv.includes("--all"), quiet: argv.includes("--quiet"), json: argv.includes("--json") });
  process.exit(exitCode(sum));
}

if (isMain(import.meta.url)) main();
