#!/usr/bin/env node
// skill-lint — Layer 1 of PluginEval-inspired quality checks across .claude/skills/.
// Detector set modelled on wshobson/agents' anti-pattern detectors (5 of their 6, chosen at this project's meta v2.6.4); the code was written here.
//
// Detectors (per skill):
// - EMPTY_DESCRIPTION   — description shorter than 20 chars
// - MISSING_TRIGGER     — description doesn't include "Use when…" / "Use this when…" framing
// - BLOATED_SKILL       — SKILL.md > 800 lines (unconditional), OR > 600 with no references/
// - SPEC_OVER_READ_BAND — SKILL.md bytes over the read guard's ARM-A band (the byte axis, 2026-09-13)
// - ORPHAN_REFERENCE    — SKILL.md links to a `.claude/skills/X/` that doesn't exist, OR a
//   references/<file>.md that doesn't resolve (file-level clause implemented 2026-07-11 —
//   documented in AUTHORING.md since v2.6.4 but unimplemented; external-* exempt from bare form)
// - CHECK_PATH_ROT      — a `checks:` frontmatter owned-check path that no longer resolves (2026-07-05);
//   a `checks:` value that is neither `[]` nor a block list is an UNSCANNED marker (2026-09-14)
// - MISSING_FRONTMATTER — SKILL.md missing `name:` or `description:` field
// - MISSING_SKILL_MD    — a named skill with no SKILL.md
//
// Corpus-level detectors (one pseudo-unit each, appended on a full-corpus lint):
// - AGENT_MODEL_PIN     — a `.claude/agents/<name>.md` whose `model:` is anything but `inherit`, or is
//   missing: the launching seat picks the model per dispatch (it replaced the 2026-07-11
//   MISSING_MODEL_PIN, which required a static opus|sonnet|haiku pin)
// - AGENT_SKILL_PAIRING — a `.claude/agents/<name>.md` (≠ _agent-primer.md) has no paired
//   `.claude/skills/<name>/MEMORY.md` (orphan agent — dispatches but loads no knowledge base)
// - MEMORY_ENVELOPE_DEBRIS — harness envelope text (`</result>`, `<usage>…</usage>`,
//   `</task-notification>`) pasted into a memory BODY by a transcript recovery, told apart from prose
//   that merely quotes the tags; see envelopeDebrisLines() (corpus-level, warn, 2026-09-13)
// - ARCH_DOC_DRIFT · COMPARISON_BANNER_DRIFT · ARCH_DOC_LISTING_DRIFT · ARCH_DOC_LISTING_MISSING ·
//   ARCH_DOC_LISTING_EXTRA · ARCH_DOC_ANCHOR_ROT · ARCH_DOC_APPENDIX_C — the five sections of
//   `architecture-counts.mjs check`, parsed BY SECTION since 2026-09-14. Before that one regex ran
//   over the whole stderr: a COMPARISON.md banner drift (same line template as the doc drift) came
//   out labelled ARCH_DOC_DRIFT, and EXTRA-in-listing, anchor rot and Appendix C were dropped unread.
// - NARRATIVE_COUNT_DRIFT — prose count claims ("of N skills", "N distinct lessons",
//   "/meta (N subcommands)") vs `architecture-counts.mjs list`
//
// ⛔ THE UNSCANNED CONVENTION (2026-09-14) — a unit that could not examine its population does not
// return an empty findings list. A missing doc, a sub-process that crashed or whose output this parser
// cannot read, an SSOT key that vanished, a pattern that matches nothing across every doc, a directory
// it cannot list or stat, a frontmatter list it cannot parse: each is a finding under the unit's own
// code, warn severity, `unscanned: true` in --json, message opening `UNSCANNED`. It counts in
// `Total findings`, keeps the unit out of `Clean units`, and the summary prints an `Unscanned units:`
// line naming the units. Before this, ten such sites returned [] — byte-identical to a clean corpus
// (found by a whole-file audit of this script). The envelope walker
// (2026-09-13) had the shape first; this generalises it. `--self-test` drives every marked site
// through a fixture tree and a stub sub-process, with a control beside each arm that must read the
// other way — for every site the fixture can reach; the two `spawnSync` `r.error` branches (the emitter
// could not be SPAWNED, as opposed to crashed) are the unarmed remainder, named here rather than faked
// (a deletion matrix: 13 red / 5 green, and the 5 green included two sites this header
// then called armed). A marker's severity is the highest the unit could have emitted had it looked (see
// unscanned()): warn for the four units whose codes are all warn, ERROR for the agents roster and for a
// skill entry the enumerator cannot stat — so `--severity=fail` reds on an unreadable roster or entry
// exactly as it would have on the finding the unreadable thing may hide, and a rename or a permission
// change cannot disarm a hard CI gate with a green build.
//
// RETIRED 2026-09-14, in the same change:
// - OUT_OF_ORDER_LESSONS · MISSING_LESSON_NUMBER · DUPLICATE_LESSON · RENUMBER_COLLISION — read
//   ONE memory file ALONE, and that file has been a two-tier ROUTER holding zero lesson definitions
//   since the archive split, so all four were inert (measured 2026-09-13). The concern — a duplicate
//   or reused L# — is a HARD pre-push gate in scripts/check-lesson-numbers.mjs
//   (mutation-valid `--self-test` in the smoke suite). One detector
//   per concern; the inert copy is gone rather than marked on every run. ⚠️ That gate is a superset on
//   the CORPUS axis only: its `declared` set is populated from HEADING-form declarations, so a
//   bullet-declared number cannot raise a duplicate there, while the retired DUPLICATE_LESSON was
//   bullet-only by design (measured both ways). The retirement still
//   loses zero coverage — the retired unit read that one memory file alone, which holds 0 definitions of either
//   shape — but the bullet-form monotonic sub-list discriminator it carried (`bulletDefs`, the
//   `num < runningMax - 1` gate) is the expensive part of
//   closing that gate's 285-number blind set.
// - RULES_ROWCOUNT_DRIFT — guarded "~N-row catalog" claims in CLAUDE.md, active-recall.md and
//   behavioral-anti-patterns.md. CLAUDE.md's editing note forbids a number where a spec can be cited,
//   and the other two are parked (path-scoped to the rules archive since 2026-09-07): the claim
//   population is 0 by policy (measured 2026-09-14), so the detector would have marked every run.
//
// Skipped per intentional design choice (the wshobson adoption verdict):
// - OVER_CONSTRAINED — we encode rule-heavy skills intentionally; >15 MUST/ALWAYS/NEVER
//   directives is fine for our 140+ codified-lesson system.
//
// Usage:
//   node scripts/skill-lint.mjs                     # lint all skills, report findings
//   node scripts/skill-lint.mjs <skill-name>        # lint single skill
//   node scripts/skill-lint.mjs --json              # JSON output (CI-friendly; a marker carries unscanned: true)
//   node scripts/skill-lint.mjs --severity=fail     # exit 1 iff an ERROR-severity finding exists
//
// ⛔ THAT FLAG IS NARROWER THAN THIS LINE ONCE SAID, AND THE OLD WORDING ("exit non-zero on any
// finding") WAS WRONG IN THE DIRECTION THAT MATTERS. The exit is gated on
// `f.severity === "error"` at the `failOnFindings` block below — warn- and info-severity
// findings, UNSCANNED markers included, NEVER red the build. Proof, measured on a peer's tree
// 2026-09-13 while this flag was being wired into CI: 14 findings present, rc=0.
// Why the correction is worth its bytes rather than being cosmetic: a comment that
// misdescribes a guard tells the next reader which edits not to bother checking. Someone
// reading the old line concludes a `warn` detector is CI-blocking, so the next author who
// needs a detector to actually stop the build may leave it at `warn` — and CI stays green
// over exactly the thing they meant to catch.
// Error severity is declared for 4 CODES — MISSING_FRONTMATTER, MISSING_SKILL_MD,
// AGENT_SKILL_PAIRING, AGENT_MODEL_PIN — at 8 SITES; both numbers are right and they count
// different things; re-derive rather than quoting either. A fifth code, DUPLICATE_LESSON, was
// DECLARED and NOT REACHABLE: it lived in lintMetaMemoryNumbering(), which early-returned on
// `lessons.length === 0`, and the memory file it read is a two-tier ROUTER holding ZERO lesson
// definitions in any of the four shapes that matcher accepted (measured 2026-09-13) —
// wired-but-inert inside the linter that exists to catch it, a detector counted as coverage
// because it was DECLARED. Retired with its three siblings the day after this flag was armed in
// CI (RETIRED, above).

import {
  readdirSync, readFileSync, existsSync, statSync,
  // ── the EXIT-PATH self-test arm needs these ──
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, copyFileSync, rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SKILLS_DIR = join(ROOT, ".claude/skills");
const AGENTS_DIR = join(ROOT, ".claude/agents");
const PROJECT_MEMORY_DIR = join(ROOT, ".claude/project-memory");

// The UNSCANNED marker (header § THE UNSCANNED CONVENTION): one shape for every site that could not
// examine its population. The message opens `UNSCANNED` so a reader and the walker's self-test arm
// (`f.msg.startsWith("UNSCANNED")`) both see it; the field is what the summary and --json consumers
// key on, so a marker is never told apart from a finding by parsing its prose.
// ⛔ SEVERITY IS THE HIGHEST THE UNIT COULD HAVE EMITTED HAD IT LOOKED — not a uniform warn.
// `--severity=fail` reds only on `error`, so a warn marker standing in for an
// error-capable unit turns a hard CI gate off with a green build: measured, an orphan agent present →
// rc=1, `.claude/agents` absent → rc=0 under the first version of this helper. Warn is right for the
// units whose codes are all warn; the agents roster (the tool's only error-capable corpus-level unit)
// and an unreadable skill entry (which could hide MISSING_FRONTMATTER / MISSING_SKILL_MD) pass "error".
function unscanned(code, msg, severity = "warn") {
  return { code, severity, unscanned: true, msg: msg.startsWith("UNSCANNED") ? msg : `UNSCANNED ${msg}` };
}

// ⛔ DERIVE THE READ BAND FROM THE GUARD THAT ENFORCES IT — never restate the number.
// Same contract as scripts/rules-tier-split.mjs guardThreshold(): two constants for one
// obligation is how a router comes to advertise "reads whole" over a deniable file.
const READ_GUARD = join(ROOT, ".claude/hooks/warn-large-tracker-read.sh");
let _band;
function readBandThreshold() {
  if (_band !== undefined) return _band;
  try {
    // ⛔ TRACKER_THRESHOLD, NOT SKILLMEM_THRESHOLD — DERIVE THE ARM, NOT JUST THE NUMBER.
    // This function's own headline says derive the band from the guard that enforces it, and the
    // first version still picked the wrong one of the guard's TWO constants. The guard classifies
    // `.claude/skills/*/SKILL.md` as `KIND=tracker; IS_WHOLEREAD=1` (renamed from `IS_SPEC` 2026-09-13) and its own comment says SKILL.md
    // "JOINS ARM A ... DELIBERATELY, NOT ARM B" — so the band that governs THIS path is ARM A's
    // TRACKER_THRESHOLD (51200), not ARM B's SKILLMEM_THRESHOLD (57500).
    // Measured 2026-09-13: the wrong arm made the populations disagree,
    // guard 9 specs vs linter 8, and the file it silently dropped was
    // one skill spec at 56,472 B — warned by the guard, invisible here.
    const m = readFileSync(READ_GUARD, "utf8").match(/^TRACKER_THRESHOLD=(\d+)/m);
    _band = m ? Number(m[1]) : null;
  } catch {
    _band = null;
  }
  return _band;
}

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const failOnFindings = args.includes("--severity=fail");
const showInfo = args.includes("--info"); // info-severity findings (benign gaps/dual-index) are suppressed by default
const targetSkill = args.find((a) => !a.startsWith("--"));

// ⛔ THE ESCAPE HATCH HAS TO BE REACHABLE FROM WHERE THE GATE BLOCKS, AND UNTIL NOW IT WAS NOT.
// `SKIP_SKILL_LINT` was read ONLY by .githooks/pre-commit, so it could relieve a LOCAL commit and
// had no effect on the CI job that can actually red the build: this script read ZERO env vars
// (`grep -c process.env` → 0), the workflow carries no `continue-on-error`, and loosening it
// otherwise takes a commit AND an owner-gated push. Every sibling warn-mode gate in this repo has
// a reachable bypass — its own `SKIP_*` env var — and this one did not, which is the asymmetry
// rather than a policy choice. Same variable name on purpose: one documented switch for one gate,
// whichever plane you meet it on.
if (process.env.SKIP_SKILL_LINT === "1") {
  console.error("→ SKIP_SKILL_LINT=1 set — skipping skill-lint (warn-mode gate)");
  process.exit(0);
}

// MISSING_TRIGGER detector regex, extracted so it's testable + can't silently drift (added 2026-06-18).
function hasTriggerFraming(description) {
  return /\b(use (when|this when|this skill when|this expert when|this skill for|at|before|after|for|during|proactively|periodically|regularly|whenever|as)|when the user|when asking|when making|when bootstrapping)\b/i.test(description);
}

// A `disable-model-invocation: true` skill is never matched on its description (only `/name` reaches it),
// so MISSING_TRIGGER has no reader there.
function modelInvocable(fm) {
  return !/^disable-model-invocation:\s*true\s*$/m.test(fm);
}

// The whole MISSING_TRIGGER predicate, so the self-test reaches the call site's conjunction and not only its parts.
function missingTrigger(description, fm) {
  return !!description && description.length >= 20 && modelInvocable(fm) && !hasTriggerFraming(description);
}

// CHECK_PATH_ROT core, extracted so it has a COMMITTED regression control: a detector whose
// --self-test never exercises it can silently go inert on a future refactor while the suite
// stays green — applied to the rot-detector itself.
function checksPathRot(fm, rootDir) {
  const missing = [];
  const b = fm.match(/^checks:\s*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  if (!b) return missing;
  for (const line of b[1].split("\n")) {
    const pm = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!pm) continue;
    const p = pm[1].replace(/^["']|["']$/g, "");
    if (!existsSync(join(rootDir, p))) missing.push(p);
  }
  return missing;
}

// The `checks:` forms checksPathRot() reads: `checks: []` (no owned check yet — honest, silent) and a
// block list. Anything else non-empty — a flow-style `[a, b]`, a bare scalar — was NOT parsed, and until
// 2026-09-14 that was silent: the rot check simply did not run over it. Returns the raw value when a
// `checks:` line carries something that is neither form, else null (0 such files at 2026-09-14: 7 `[]`,
// 5 block lists). Pure; armed by --self-test.
function checksUnparsed(fm) {
  const m = fm.match(/^checks:[ \t]*(.*)$/m);
  if (!m) return null;
  const v = m[1].trim();
  if (v === "" || /^\[\s*\]$/.test(v)) return null;
  return v;
}

// ORPHAN_REFERENCE file-level core (2026-07-11, wshobson calibration). AUTHORING.md's detector
// table has documented "links references/<file>.md that doesn't exist" since v2.6.4, but only the
// skill-DIR form (wshobson's DEAD_CROSS_REF) was implemented — the documented file-level form
// (their actual ORPHAN_REFERENCE) was missing, and one real rot shipped through the gap
// (wrap/SKILL.md → meta's process-learn.md, fixed same commit). FP classes MEASURED before
// implementing (7 of 8 naive-scan hits were FPs): (a) a bare `references/X.md` resolves against
// the OWNING skill dir, never ROOT; (b) a full `.claude/skills/<x>/references/…` path resolves
// cross-skill (the bare matcher excludes it via the preceding-`/` guard); (c) external-* skills
// quote the EXTERNAL repo's own file layout → exempt
// from the bare-relative form.
function orphanFileRefs(content, skillDir, skillName) {
  const missing = new Set();
  if (!skillName.startsWith("external-")) {
    for (const m of content.matchAll(/(^|[^/\w-])(references\/[a-zA-Z0-9._/-]+\.md)/g)) {
      if (!existsSync(join(skillDir, m[2]))) missing.add(m[2]);
    }
  }
  for (const m of content.matchAll(/\.claude\/skills\/([a-z0-9-]+)\/(references\/[a-zA-Z0-9._/-]+\.md)/gi)) {
    if (!existsSync(join(SKILLS_DIR, m[1], m[2]))) missing.add(`.claude/skills/${m[1]}/${m[2]}`);
  }
  return [...missing];
}

// AGENT_MODEL_PIN core. Agent definitions do not fix a model: every definition says `model: inherit`,
// so the seat that launches a helper picks it — a launch that names a model gets it, one that names
// none runs on the session's model. It INVERTS the 2026-07-11
// MISSING_MODEL_PIN (wshobson calibration), which required a static opus|sonnet|haiku pin as a cost ceiling
// under a Fable orchestrator; that cost is now the launching seat's call. A missing line also fires: it
// would leave the choice to the harness's default.
// Extracted for self-test (same rationale as checksPathRot). Returns null when `inherit`, "missing" when there
// is no model line or no frontmatter, or the offending value.
function modelPinIssue(body) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return "missing";
  const pin = fmMatch[1].match(/^model:\s*(\S+)/m);
  if (!pin) return "missing";
  // ⛔ STRIP THE QUOTES BEFORE THE TEST — `\S+` CAPTURES THEM, AND QUOTED YAML IS LEGAL.
  // Without this, a valid `model: "inherit"` captures `"inherit"`, fails the test, and fires at ERROR
  // severity (the predecessor MISSING_MODEL_PIN shipped exactly that with `"opus"`). Filed 2026-07-11 and DORMANT the whole time because all
  // agent files happen to use the unquoted form — 0 live false-flags then and now. **Arming
  // `--severity=fail` in CI is what converted it from an invisible warn into a fleet-wide CI red**,
  // clearable only by an owner-gated push, so the latent footgun became a live one on a commit that
  // touched this file. Its revisit trigger was "next touch of scripts/skill-lint.mjs" and it fired
  // on exactly that commit without surfacing — the audit's own finding class (a registered trigger
  // nothing reads) landing on the audit's own work. Fix is the one specified when it was filed.
  const pinned = pin[1].replace(/^["']|["']$/g, "");
  return pinned === "inherit" ? null : pinned;
}

// MEMORY_ENVELOPE_DEBRIS core (2026-09-13).
// A transcript recovery that pastes an agent's return into a memory file carries the harness envelope with it:
// a `</result>` glued to the last prose line, a `<usage><subagent_tokens>…</usage>` line, a `</task-notification>`
// line. A bare token grep cannot be the detector, because memory prose also QUOTES these tags: on the 449-file
// memory corpus the tokens sit on 40 lines — this detector flags 32 of them, in 14 files, and leaves
// the 8 lines of prose about the tags, in 6 files (re-derived 2026-09-13 by running this function over every blob
// at one ref). The hand classification it was built against counted 30 debris lines in 13 files; the two it missed
// are two adjacent lines of one skill's memory file — real debris, present at that ref and unchanged since.
// Of nine candidate rules scored against that hand classification, a bare grep, a line-start-only rule and the
// predicates two earlier sweeps used all misclassify real ones. "Not inside backticks" alone also scored clean, but only
// because every quoted mention happens to be backticked, and this corpus writes other tags bare in prose
// (`<summary>`, `<div>`, `<button>` in accessibility-expert's archive) — so the rule also demands a line edge,
// which no mid-sentence mention reaches. A token is DEBRIS when it is outside any inline code span and any
// fenced block, AND
//   (a) the left-trimmed line STARTS with an envelope element — then every token on the line counts; or
//   (b) a closing tag ENDS the line, once trailing whitespace and one JSONL `"}` residue are stripped; or
//   (c) a closing tag is followed by ` → ` or ` | `. NOT part of P2: it is the shape memory-tier-split.mjs's
//       indexRow() and routerDigestRows() emit when a digest sentence or Revisit line ends in a glued closer
//       (`…</result> → ARCHIVE`, `…</result> | Revisit:`), so the index row that outlives a cleaned body is
//       still seen. No line in the corpus above has that shape, so (c) adds no flag there.
// `<summary>` / `<status>` / `<name>` / `<output>` stay OUT of the line-start set — they open ordinary HTML and
// placeholder lines.
// Fences follow CommonMark (close only on the same character, at least as long, nothing after it); P2 toggled
// on any ``` / ~~~ line. The two agree on every token-bearing line of the corpus above.
// Known gaps, no real site to measure: a code span is parsed within one line (CommonMark lets it cross a soft
// break); a fence IS recognized at up to 3 spaces of indent, which is where a list item puts one (10 such lines in
// that corpus, and no file ends inside an open fence), but NOT at 4+ spaces or inside a blockquote — 0 of each in
// that corpus, and 0 token-bearing lines indented that far; a glued closer followed by anything other than
// end-of-line, ` → ` or ` | ` is not seen. Promoting this check to error needs an arm or a closure for each.
// And the use-vs-mention split rests on SYNTHETIC arms: dropping the line-edge rule alone, or the code-span
// exclusion alone, still flags exactly those same 32 real lines, so no corpus line discriminates either rule.
const ENVELOPE_LINE_START = ["<usage>", "</usage>", "<task-notification>", "</task-notification>", "<result>", "</result>", "<task-id>", "<tool-use-id>", "<output-file>", "<subagent_tokens>", "<worktree>", "<system-reminder>", "</system-reminder>", "<function_results>"];
const ENVELOPE_CLOSERS = ["</result>", "</usage>", "</task-notification>", "</system-reminder>", "</function_results>"];
const ENVELOPE_TOKENS = [...new Set([...ENVELOPE_LINE_START, ...ENVELOPE_CLOSERS])];
const INDEX_ROW_SUFFIXES = [" → ", " | "];

// Inline code spans on ONE line: a run of N backticks opens a span that closes at the next run of exactly N.
function inlineCodeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") { i++; continue; }
    let j = i;
    while (line[j] === "`") j++;
    let k = j;
    let close = -1;
    while (k < line.length) {
      if (line[k] !== "`") { k++; continue; }
      let m = k;
      while (line[m] === "`") m++;
      if (m - k === j - i) { close = m; break; }
      k = m;
    }
    if (close === -1) { i = j; continue; }
    spans.push([i, close]);
    i = close;
  }
  return spans;
}

// Pure: one file's text in, [{ line, tokens }] out — 1-based line numbers, every flagged token in column order.
function envelopeDebrisLines(text) {
  const hits = [];
  let fence = null; // { ch, len } while inside a fenced block
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && fm[2].trim() === "") fence = null;
      continue;
    }
    if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
      fence = { ch: fm[1][0], len: fm[1].length };
      continue;
    }
    if (!line.includes("<")) continue;
    const found = [];
    for (const tok of ENVELOPE_TOKENS) {
      for (let c = line.indexOf(tok); c !== -1; c = line.indexOf(tok, c + 1)) found.push([c, tok]);
    }
    if (found.length === 0) continue;
    const lead = line.trimStart();
    const startsEnvelope = ENVELOPE_LINE_START.some((t) => lead.startsWith(t));
    let tail = line.trimEnd();
    if (tail.endsWith('"}')) tail = tail.slice(0, -2).trimEnd();
    const spans = inlineCodeSpans(line);
    const tokens = found
      .sort((a, b) => a[0] - b[0])
      .filter(([c, tok]) => {
        if (spans.some(([a, b]) => c >= a && c < b)) return false;
        if (startsEnvelope) return true;
        if (!ENVELOPE_CLOSERS.includes(tok)) return false;
        const end = c + tok.length;
        return end === tail.length || INDEX_ROW_SUFFIXES.some((s) => line.startsWith(s, end));
      })
      .map(([, tok]) => tok);
    if (tokens.length) hits.push({ line: i + 1, tokens });
  }
  return hits;
}

// --self-test: regression guard for the trigger-framing detector (locks in the 2026-06-17 +periodically|regularly change).
if (args.includes("--self-test")) {
  const cases = [
    ["Use periodically (~monthly) or before an /external-audit.", true],
    ["Use when designing or evaluating large-scale plugin marketplaces.", true],
    ["Use this skill for X.", true],
    ["Use as /wrap's optional last step.", true],
    ["When the user wants to evaluate plugin quality.", true],
    ["This skill orchestrates agents. It produces a summary.", false],
    ["A reference catalog of external systems.", false],
  ];
  let pass = 0, fail = 0;
  for (const [desc, expect] of cases) {
    const ok = hasTriggerFraming(desc) === expect;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}: expect=${expect}  "${desc.slice(0, 50)}"`);
  }
  const miOk = modelInvocable("name: x\ndisable-model-invocation: true\n") === false && modelInvocable("name: x\ndescription: y\n") === true;
  miOk ? pass++ : fail++;
  console.log(`${miOk ? "PASS" : "FAIL"}: modelInvocable — disable-model-invocation: true exempts MISSING_TRIGGER, its absence does not`);
  const untriggered = "This skill orchestrates agents. It produces a summary.";
  const mtOk = missingTrigger(untriggered, "name: x\ndisable-model-invocation: true\n") === false && missingTrigger(untriggered, "name: x\n") === true;
  mtOk ? pass++ : fail++;
  console.log(`${mtOk ? "PASS" : "FAIL"}: missingTrigger — the call-site predicate honours the exemption and still fires without it`);
  // CHECK_PATH_ROT committed regression control: a bad checks: path
  // must produce a miss, a good one must not — so a future refactor can't silently render the
  // rot-detector inert while the suite stays green.
  const rotBad = checksPathRot("checks:\n  - tests/__does_not_exist__.test.ts\n", ROOT).length;
  const rotGood = checksPathRot("checks:\n  - scripts/skill-lint.mjs\n", ROOT).length;
  const rotOk = rotBad === 1 && rotGood === 0;
  rotOk ? pass++ : fail++;
  console.log(`${rotOk ? "PASS" : "FAIL"}: CHECK_PATH_ROT bad-path fires (${rotBad}) / good-path silent (${rotGood})`);
  // checksUnparsed(): the two honest forms stay null, the two unparsed forms return their value.
  const chkCases = [
    ["checks: []\n", null],
    ["checks:\n  - scripts/skill-lint.mjs\n", null],
    ["name: x\ndescription: y\n", null],
    ["checks: [tests/a.test.ts, tests/b.test.ts]\n", "[tests/a.test.ts, tests/b.test.ts]"],
    ["checks: tests/a.test.ts\n", "tests/a.test.ts"],
  ];
  const chkOk = chkCases.every(([fm, want]) => checksUnparsed(fm) === want);
  chkOk ? pass++ : fail++;
  console.log(`${chkOk ? "PASS" : "FAIL"}: checksUnparsed() null on \`[]\` / block list / absent; returns a flow-style list and a bare scalar`);

  // ORPHAN_REFERENCE file-level regression controls — one per measured FP class + the fire case
  // (the bad case IS the committed mutation proof that the detector isn't inert).
  const orphMeta = join(SKILLS_DIR, "meta");
  const orphBad = orphanFileRefs("see `references/__does_not_exist__.md`", orphMeta, "meta").length;
  const orphGood = orphanFileRefs("see `references/process-learn.md`", orphMeta, "meta").length;
  const orphExt = orphanFileRefs("per `references/monorepo-flow.md`", join(SKILLS_DIR, "external-<catalog-skill>"), "external-<catalog-skill>").length;
  const orphFull = orphanFileRefs("consult `.claude/skills/expert-review/references/department-directory.md`", orphMeta, "meta").length;
  const orphOk = orphBad === 1 && orphGood === 0 && orphExt === 0 && orphFull === 0;
  orphOk ? pass++ : fail++;
  console.log(`${orphOk ? "PASS" : "FAIL"}: ORPHAN_REFERENCE file-level bad(${orphBad}) good(${orphGood}) external-exempt(${orphExt}) full-path(${orphFull})`);

  // AGENT_MODEL_PIN regression controls — no model line, and every fixed model, must fire; inherit must not.
  const pinCases = [
    ["---\nname: x\ndescription: y\n---\nbody", "missing"],
    // No frontmatter at all (a `model:` line in the body is not a frontmatter field): it must fire as "missing".
    // A mutant returning null on the no-frontmatter branch passed this self-test until this arm.
    ["model: inherit\nname: x\nbody", "missing"],
    ["---\nname: x\nmodel: opus\n---", "opus"],
    ["---\nname: x\nmodel: sonnet\n---", "sonnet"],
    ["---\nname: x\nmodel: inherit\n---", null],
    ["---\nname: x\nmodel: fable\n---", "fable"],
    // Quoted YAML is legal. Both arms are load-bearing and they must go OPPOSITE ways: a quoted
    // `inherit` must be SILENT, and a quoted fixed model must still fire, reported WITHOUT quotes so
    // the message reads as the author wrote it (the quote-strip must not turn the detector off).
    ['---\nname: x\nmodel: "inherit"\n---', null],
    ["---\nname: x\nmodel: 'sonnet'\n---", "sonnet"],
    ['---\nname: x\nmodel: "fable"\n---', "fable"],
  ];
  const pinOk = pinCases.every(([b, want]) => modelPinIssue(b) === want);
  pinOk ? pass++ : fail++;
  console.log(`${pinOk ? "PASS" : "FAIL"}: AGENT_MODEL_PIN missing/opus/sonnet/fable fire; inherit silent (quoted forms both ways)`);

  // MEMORY_ENVELOPE_DEBRIS arms. Fixture lines are copied from real memory-file lines (whole lines, or part
  // of one) unless the label says SYNTHETIC. Each arm pins the exact [line, ...tokens] list, so a wrong
  // token list fails as surely as a wrong line.
  const envArm = (label, lines, want) => {
    const got = JSON.stringify(envelopeDebrisLines(lines.join("\n")).map((h) => [h.line, ...h.tokens]));
    const ok = got === JSON.stringify(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}: MEMORY_ENVELOPE_DEBRIS ${label}${ok ? "" : `  want=${JSON.stringify(want)} got=${got}`}`);
  };
  const SE591 = "Revisit: none — flat rule. Any interim fix justified by a property of another module owes an arm on that property, plus the mutation showing what the permanent fix will flip.</result>";
  const CA264 = "re-opens; also if `/summary`'s citation count moves off zero.</result>";
  const CA265 = "<usage><subagent_tokens>259377</subagent_tokens><tool_uses>29</tool_uses><duration_ms>638471</duration_ms></usage>";
  const CA266 = "</task-notification>";
  const USAGE3 = ["<usage>", "<subagent_tokens>", "</usage>"];
  envArm("POS prose line ending in </result>", [SE591], [[1, "</result>"]]);
  envArm("POS </result> + <usage> + </task-notification> block", [CA264, CA265, CA266, ""],
    [[1, "</result>"], [2, ...USAGE3], [3, "</task-notification>"]]);
  envArm("POS cut-off <usage> stub", ["<usage><subagent_tokens>252262</subagent_tok", ""],
    [[1, "<usage>", "<subagent_tokens>"]]);
  envArm("POS </task-notification> with JSONL residue", ['</task-notification>"}'], [[1, "</task-notification>"]]);
  envArm("POS <usage> line with no closing line after it", [
    'Revisit: if compliance rate is ever measured at run-position 1 vs ≥5 (derivable from existing logs, zero spend) — that is the only instrument separating "duplicates help" from "duplicates tax," and it would settle the magnitude I could not.',
    "<usage><subagent_tokens>369825</subagent_tokens><tool_uses>2</tool_uses><duration_ms>218283</duration_ms></usage>",
    "",
  ], [[2, ...USAGE3]]);
  envArm("NEG debris shape quoted in backticks mid-prose", [
    'Every block carried a trailing `<usage><subagent_tokens>…</usage>` plus `</task-notification>"}` into the durable file. **All five, identically.**',
  ], []);
  envArm("NEG `grep -c '<usage>'` in backticks", [
    "plausible, common, and it would have closed the check. `grep -c '<usage>'` per file returned **1/1/1/1/1**. The tell that should fire: **you are looking at a spot-check you did not need to run, and explaining away its result.**",
  ], []);
  envArm("NEG the same block inside a ``` fence; the block again after the fence still fires", ["```", CA264, CA265, CA266, "```", CA264, CA265, CA266],
    [[6, "</result>"], [7, ...USAGE3], [8, "</task-notification>"]]);
  envArm("NEG bare <summary> mid-prose and opening a line", [
    "Fixed: hero tagline text-muted-foreground/70 = 3.53:1 (FAIL 1.4.3) → full token 6.36:1; FAQ <summary> focus-visible (2.4.7 — outside the pre-push <button|<a|<Link regex, 5th such surface).",
    "<summary><b>⚠️ The first draft of this sentence was a lie. Read why — it is the best single argument for the product.</b></summary>",
  ], []);
  // SYNTHETIC — the line-edge requirement, the one thing separating this rule from "not inside backticks" alone
  // (which also scored clean on the real corpus). Both tags are bare and mid-sentence, the way this corpus already
  // writes other tags in prose; the backticks-only rule would flag both, this rule flags neither.
  envArm("SYNTHETIC bare envelope tags mid-sentence stay silent (the line edge, not the backticks, separates prose from a paste)", [
    "The recovery pasted a <usage> line and a </task-notification> line under the entry, and the prose above them survived.",
  ], []);
  // SYNTHETIC — the indexRow gap. Both rows are memory-tier-split.mjs output (splitMemory -> indexRow) for entries
  // whose Revisit line / first sentence ends in a glued </result>. P2 AS WRITTEN MISSES BOTH (the line opens with
  // `- ` and the closer is mid-line); branch (c) is what flags them. The third line quotes the shape in backticks
  // and must stay silent — the one arm where the code-span exclusion can change a verdict.
  envArm("SYNTHETIC indexRow mid-line closer (` → ARCHIVE`, ` | Revisit:`): branch (c) fires where P2 alone would not; backticked quote silent", [
    "- 2026-09-05 — An interim fix's premise belongs in an arm — Both library properties were comment claims. | Revisit: none — flat rule. Any interim fix justified by a property of another module owes an arm on that property, plus the mutation showing what the permanent fix will flip.</result> → ARCHIVE",
    "- 2026-09-06 — Glued first line — Flat rule with no exceptions</result> | Revisit: none — flat rule → ARCHIVE",
    "a stale index row reads `…will flip.</result> → ARCHIVE` after its body was cleaned",
  ], [[1, "</result>"], [2, "</result>"]]);
  envArm("SYNTHETIC ``` inside a ```` fence does not close it (CommonMark; P2's toggle would flip there)", ["````markdown", "```", CA265, "```", CA266, "````", CA266],
    [[7, "</task-notification>"]]);
  envArm("SYNTHETIC glued </result> then a JSONL \"} residue (P2's strip; both real \"} sites open with </task-notification>)", [`${SE591}"}`], [[1, "</result>"]]);
  // SYNTHETIC, DIRECT on inlineCodeSpans(). The exclusion it feeds changed no verdict on the real corpus (the 449 files
  // flag the same 32 lines with it removed), and before these arms ONE synthetic line certified it — the
  // backticked quote in the indexRow arm above. These two pin the PAIRING rules that line never exercises, each as a
  // span list AND a verdict on a line where a span decides it. One mutant each, measured 2026-09-13: removing the
  // exclusion reds all three arms; closing a span at the LAST equal-length run reds only the first (spans [[8,36]]);
  // stopping at an unclosed run reds only the second (spans []).
  const spanArm = (label, line, wantSpans, wantHits) => {
    const gotSpans = JSON.stringify(inlineCodeSpans(line));
    const gotHits = JSON.stringify(envelopeDebrisLines(line).map((h) => [h.line, ...h.tokens]));
    const ok = gotSpans === JSON.stringify(wantSpans) && gotHits === JSON.stringify(wantHits);
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}: MEMORY_ENVELOPE_DEBRIS ${label}${ok ? "" : `  spans want=${JSON.stringify(wantSpans)} got=${gotSpans}; hits want=${JSON.stringify(wantHits)} got=${gotHits}`}`);
  };
  spanArm("SYNTHETIC equal-length runs pair in order, never outermost-first: </result> between two spans fires, </usage> inside the third does not",
    "<usage> `a `</result>` b` `</usage>`", [[8, 12], [21, 25], [26, 36]], [[1, "<usage>", "</result>"]]);
  spanArm("SYNTHETIC an unclosed `` run is skipped, not a span to end of line: the real span after it hides its closer, the bare index-row closer after that fires",
    "a stray `` run, then `</result> → quoted` and a glued row</result> | Revisit: none", [[21, 41]], [[1, "</result>"]]);
  // Walker: an unlistable root is an UNSCANNED finding and never a throw (CI runs --severity=fail, where an exception
  // reds the build over a warn check). EACH real root must yield files and no UNSCANNED finding: a total above zero
  // cannot see a walk that lost one root, because the other root's files keep the total above zero.
  let walkOk = false;
  let walkWhy = "";
  try {
    const unscanned = (r) => r.findings.filter((f) => f.msg.startsWith("UNSCANNED")).length;
    const bogus = lintMemoryEnvelopes(join(ROOT, "__no_such_skills_dir__"), join(ROOT, "__no_such_project_memory_dir__"));
    const real = lintMemoryEnvelopes();
    const { skills, projectMemory } = real.filesByRoot;
    walkWhy = `bogus roots ${unscanned(bogus)} UNSCANNED / ${bogus.filesScanned} files; real roots ${unscanned(real)} UNSCANNED / skills ${skills} + project-memory ${projectMemory} of ${real.filesScanned} files`;
    walkOk = unscanned(bogus) === 3 && bogus.filesScanned === 0 && unscanned(real) === 0 && skills > 0 && projectMemory > 0 && skills + projectMemory === real.filesScanned;
  } catch (e) {
    walkWhy = `threw: ${e.message}`;
  }
  walkOk ? pass++ : fail++;
  console.log(`${walkOk ? "PASS" : "FAIL"}: MEMORY_ENVELOPE_DEBRIS walker reports unlistable roots as UNSCANNED without throwing; each real root scans files${walkOk ? "" : `  (${walkWhy})`}`);

  // unusableRootReason: three cases, and the REAL root is the positive control — without it an
  // always-non-null predicate would pass the two bogus cases and the arm would certify nothing.
  let rootOk = false;
  let rootWhy = "not run";
  try {
    const missing = unusableRootReason(join(ROOT, ".claude/NO-SUCH-SKILLS-ROOT"));
    const notDir = unusableRootReason(join(HERE, "skill-lint.mjs"));
    const real = unusableRootReason(SKILLS_DIR);
    rootWhy = `missing=${missing ? "reason" : "null"} notDir=${notDir ? "reason" : "null"} real=${real === null ? "null" : real}`;
    rootOk = typeof missing === "string" && typeof notDir === "string" && real === null;
  } catch (e) {
    rootWhy = `threw: ${e.message}`;
  }
  rootOk ? pass++ : fail++;
  console.log(
    `${rootOk ? "PASS" : "FAIL"}: unusableRootReason names a missing root AND a non-directory, and returns null for the real skills root (the control — a predicate that always reported a reason would pass both bogus cases) — ${rootWhy}`,
  );

  // ⛔ THE EXIT PATH, AND THE STATES THE PREDICATE EXCLUDES — SPAWNED, because neither is reachable
  // in-process. The arm above exercises `unusableRootReason`, a PURE function;
  // it cannot touch `process.exit(2)` or the sentence, and it draws every case from the population the
  // predicate already HANDLES. Measured: mutating `process.exit(2)` → `exit(1)` left
  // **26 pass / 0 fail, rc=0** — so the commit body's claim that "the predicate and the sentence
  // cannot drift apart" was not true of anything asserted. And the excluded states (unreadable root,
  // dangling entry) are exactly where the crash lived: the TWELFTH vacuous-control way, a control
  // drawn from the handled population, which cannot detect the one it excludes.
  // Each case asserts BOTH the exit code AND a sentence marker, so a mutation to either fails.
  let exitOk = false;
  let exitWhy = "not run";
  let fx = null;
  try {
    fx = mkdtempSync(join(tmpdir(), "skill-lint-exitpath-"));
    mkdirSync(join(fx, "scripts"), { recursive: true });
    copyFileSync(join(HERE, "skill-lint.mjs"), join(fx, "scripts/skill-lint.mjs"));
    const run = (args) => {
      const r = spawnSync(process.execPath, ["scripts/skill-lint.mjs", ...args], { cwd: fx, encoding: "utf8" });
      return { rc: r.status, err: r.stderr ?? "", out: r.stdout ?? "" };
    };
    const notes = [];
    const want = (label, cond) => { notes.push(`${label}=${cond ? "ok" : "BAD"}`); return cond; };

    // (1) + (2) NO skills root — the enumerating path AND the named-target path, which reaches the
    // guard only since this commit. `--severity=fail` is included because rc=1 there is the collision
    // that made a crash indistinguishable from a real error finding.
    const bare = run([]);
    const named = run(["meta"]);
    const namedFail = run(["meta", "--severity=fail"]);
    let ok = want("bare_rc2", bare.rc === 2) && want("bare_sentence", /INSTRUMENT failure/.test(bare.err));
    ok = want("named_rc2", named.rc === 2) && ok;
    ok = want("named_no_fabricated_finding", !/MISSING_SKILL_MD/.test(named.out)) && ok;
    ok = want("namedfail_rc2_not_1", namedFail.rc === 2) && ok;

    // (3) POSITIVE CONTROL — a usable root must NOT refuse. Without it every arm above passes on a
    // tool that refuses unconditionally, which is the shape this whole block exists to detect.
    mkdirSync(join(fx, ".claude/skills/realskill"), { recursive: true });
    writeFileSync(join(fx, ".claude/skills/realskill/SKILL.md"), "---\nname: realskill\ndescription: x\n---\n# Real\n");
    const good = run([]);
    ok = want("valid_root_not_refused", good.rc !== 2) && ok;

    // (4) EXCLUDED STATE — a dangling entry is a corpus ODDITY: named, skipped, run continues.
    symlinkSync(join(fx, ".claude/skills/nope"), join(fx, ".claude/skills/dangling"));
    const dang = run([]);
    ok = want("dangling_named", /skipping unreadable entry/.test(dang.err)) && ok;
    ok = want("dangling_no_stack", !/^\s+at /m.test(dang.err)) && ok;
    ok = want("dangling_not_refused", dang.rc !== 2) && ok;
    rmSync(join(fx, ".claude/skills/dangling"));

    // (5) EXCLUDED STATE — an unreadable ROOT is an INSTRUMENT failure. ⚠️ SKIPPED, NOT PASSED, when
    // the process can read it anyway (running as root, or a filesystem ignoring mode): a silent pass
    // there would be a vacuous arm, so it reports as a skip and says so.
    chmodSync(join(fx, ".claude/skills"), 0o000);
    let readable = true;
    try { readdirSync(join(fx, ".claude/skills")); } catch { readable = false; }
    if (!readable) {
      const nore = run([]);
      ok = want("unreadable_rc2", nore.rc === 2) && ok;
      ok = want("unreadable_no_stack", !/^\s+at /m.test(nore.err)) && ok;
    } else {
      notes.push("unreadable_root=SKIPPED(process can read a 000 dir)");
    }
    chmodSync(join(fx, ".claude/skills"), 0o755);

    exitOk = ok;
    exitWhy = notes.join(" ");
  } catch (e) {
    exitWhy = `threw: ${e.message}`;
  } finally {
    if (fx) { try { chmodSync(join(fx, ".claude/skills"), 0o755); } catch { /* may not exist */ } try { rmSync(fx, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  exitOk ? pass++ : fail++;
  console.log(
    `${exitOk ? "PASS" : "FAIL"}: the REFUSAL EXIT PATH is armed — rc=2 and the sentence on a missing root via BOTH entry paths, rc=2 (not 1) under --severity=fail, a valid root NOT refused, a dangling entry named-and-skipped with no stack, an unreadable root rc=2 with no stack — ${exitWhy}`,
  );

  // ⛔ THE UNSCANNED CONVENTION, ONE ARM PER SITE, EACH BESIDE A CONTROL THAT MUST READ THE OTHER WAY
  // (2026-09-14). The fixture tree and the stub are the whole-file audit's rig
  // (scripts/probes/skill-lint-silent-pass/), folded in so the suite is self-contained. SPAWNED, like the
  // exit-path block above: the units run on a copied tree against a stub `architecture-counts.mjs` whose
  // blocks copy the real emitter's line shapes (architecture-counts.mjs, the `if (cmd === "check")`
  // block), so the section parser is measured against the vocabulary it will meet. Every arm pins the
  // unit's CODE LIST and its MARKER COUNT together, so a marker arriving under the wrong code, a real
  // finding turning into a marker, or a control that starts marking fails as surely as a missing marker.
  const UNSCANNED_STUB = `// stub architecture-counts.mjs written by skill-lint --self-test; each block copies the real emitter's line shape
const mode = process.env.STUB_MODE || "clean";
const cmd = process.argv[2] || "check";
if (cmd === "list") {
  if (mode === "list-crash") { console.error("TypeError: boom\\n    at file:///stub.mjs:1:1"); process.exit(1); }
  if (mode === "list-renamed-key") { console.log(JSON.stringify({ skillCount: 107, distinctLessons: 1788, metaSubcommands: 15 })); process.exit(0); }
  console.log(JSON.stringify({ skills: 107, distinctLessons: 1788, metaSubcommands: 15 }));
  process.exit(0);
}
if (cmd === "check") {
  const blocks = {
    "clean": null,
    "count-drift": "COUNT + NARRATIVE DRIFTS (1):\\n  Line 12: skill roster — claimed 100, actual 107",
    "banner-drift": "COMPARISON.md BANNER DRIFTS (1):\\n  Line 7: skills banner — claimed 100, actual 107",
    "listing-count": "LISTING DRIFTS (1):\\n  hooks: claimed 50, listed 51",
    "listing-missing": "LISTING DRIFTS (1):\\n  hooks MISSING from listing: hooks/new-guard.sh",
    "listing-extra": "LISTING DRIFTS (1):\\n  hooks EXTRA in listing: hooks/deleted-guard.sh",
    "meta-heading": "META ENTRY-POINT HEADING DRIFT (1):\\n  meta/SKILL.md heading \\"Primary entry points (15 — …)\\" — claimed 15, bullets 16 — hand-edit the heading's number",
    "appx-c": "APPENDIX C COVERAGE (1):\\n  L# cited in body but missing from Appendix C: L7",
    "anchor-rot": "NARRATIVE ANCHOR ROT (1):\\n  skills: every narrative matcher for this key matched ZERO sentences while architecture.md exists — the anchor sentence was likely reworded or removed. Rot here is otherwise SILENT (no match → no drift entry → a stale number is never re-checked). Re-anchor the matcher in PATTERNS, or retire the key from NARRATIVE_EXPECTED_KEYS if the doc deliberately dropped the claim.",
    "reworded": "COUNT + NARRATIVE DRIFTS (1):\\n  line 12: skill roster: claims 100 but there are 107",
    "new-section": "COUNT + NARRATIVE DRIFTS (1):\\n  Line 12: skill roster — claimed 100, actual 107\\n\\nSOMETHING NEW (2):\\n  a finding this parser has never seen\\n  and another",
    "new-section-hyphen": "COUNT + NARRATIVE DRIFTS (1):\\n  Line 12: skill roster — claimed 100, actual 107\\n\\nNEW-SECTION (1):\\n  a finding this parser has never seen",
    "crash": "file:///stub.mjs:9\\n  const x = undefined.match(1);\\n                        ^\\n\\nTypeError: Cannot read properties of undefined (reading 'match')\\n    at file:///stub.mjs:9:3",
  };
  if (!(mode in blocks)) { console.error("stub: unknown mode " + mode); process.exit(9); }
  const b = blocks[mode];
  if (b === null) { console.log("clean"); process.exit(0); }
  console.error("⚠️  doc-count drift detected:\\n\\n" + b + "\\n\\nRun 'node scripts/architecture-counts.mjs fix' to apply ≤5-LOC auto-fixes (drift only; listing + coverage + anchor rot surface as proposals).");
  process.exit(1);
}
console.error("stub: unknown command " + cmd); process.exit(2);
`;
  {
    let fx2 = null;
    const arms = [];
    const arm = (label, ok, why) => { arms.push([label, ok, why]); ok ? pass++ : fail++; };
    try {
      fx2 = mkdtempSync(join(tmpdir(), "skill-lint-unscanned-"));
      const w = (rp, s) => { mkdirSync(dirname(join(fx2, rp)), { recursive: true }); writeFileSync(join(fx2, rp), s); };
      mkdirSync(join(fx2, "scripts"), { recursive: true });
      copyFileSync(join(HERE, "skill-lint.mjs"), join(fx2, "scripts/skill-lint.mjs"));
      w("scripts/architecture-counts.mjs", UNSCANNED_STUB);
      w(".claude/hooks/warn-large-tracker-read.sh", "TRACKER_THRESHOLD=51200\n");
      w(".claude/skills/meta/SKILL.md", "---\nname: meta\ndescription: Use when auditing the expert system health.\n---\n# meta\n");
      w(".claude/skills/meta/MEMORY.md", "# meta MEMORY (router)\n");
      // Every surviving narrative pattern has a sentence here, so the control reads clean of markers; the
      // roster claim drifts by 13 against the stub's 107 (band ok, tolerance 5) and is the control finding.
      const DOC = "This doc covers 1 of 120 skills. It indexes 1792 distinct lessons. `/meta` (15 subcommands).\n";
      const NARRATIVE_DOCS = [".claude/docs/architecture.md", ".claude/docs/architecture-overview.md", ".claude/docs/state.md", "CLAUDE.md", ".claude/rules/active-recall.md", ".claude/skills/AUTHORING.md"];
      for (const d of NARRATIVE_DOCS) w(d, d.endsWith("docs/architecture.md") ? DOC : "\n");
      w(".claude/project-memory/x.md", "hello\n");
      const ORPHAN = "---\nname: orphan\ndescription: x\n---\n";
      w(".claude/agents/orphan.md", ORPHAN);
      const run = (args, mode = "clean") => spawnSync(process.execPath, ["scripts/skill-lint.mjs", ...args], { cwd: fx2, encoding: "utf8", env: { ...process.env, STUB_MODE: mode } });
      const unit = (r, name) => { let units; try { units = JSON.parse(r.stdout); } catch { return null; } return units.find((u) => u.name === name) ?? null; };
      const shape = (u) => (u ? `${[...new Set(u.findings.map((f) => f.code))].sort().join("+") || "-"} marks=${u.findings.filter((f) => f.unscanned === true).length}` : "<unit missing>");
      const expect = (label, args, mode, name, want) => { const got = shape(unit(run(args, mode), name)); arm(label, got === want, `want "${want}" got "${got}"`); };
      // A. lintArchitectureDoc — five sections by name, a crash, a missing doc, a reworded line
      expect("arch: clean stub → no finding, no marker (control)", ["arch", "--json"], "clean", "architecture.md", "- marks=0");
      expect("arch: COUNT + NARRATIVE DRIFTS line → ARCH_DOC_DRIFT (control)", ["arch", "--json"], "count-drift", "architecture.md", "ARCH_DOC_DRIFT marks=0");
      expect("arch: COMPARISON.md BANNER DRIFTS line → COMPARISON_BANNER_DRIFT, not the doc's code (was mislabeled ARCH_DOC_DRIFT)", ["arch", "--json"], "banner-drift", "architecture.md", "COMPARISON_BANNER_DRIFT marks=0");
      expect("arch: listing count line → ARCH_DOC_LISTING_DRIFT", ["arch", "--json"], "listing-count", "architecture.md", "ARCH_DOC_LISTING_DRIFT marks=0");
      expect("arch: MISSING from listing → ARCH_DOC_LISTING_MISSING", ["arch", "--json"], "listing-missing", "architecture.md", "ARCH_DOC_LISTING_MISSING marks=0");
      expect("arch: EXTRA in listing → ARCH_DOC_LISTING_EXTRA (was dropped unread)", ["arch", "--json"], "listing-extra", "architecture.md", "ARCH_DOC_LISTING_EXTRA marks=0");
      expect("arch: APPENDIX C COVERAGE → ARCH_DOC_APPENDIX_C (was dropped unread)", ["arch", "--json"], "appx-c", "architecture.md", "ARCH_DOC_APPENDIX_C marks=0");
      expect("arch: META ENTRY-POINT HEADING DRIFT → META_ENTRY_POINT_HEADING_DRIFT (was read as a crash)", ["arch", "--json"], "meta-heading", "architecture.md", "META_ENTRY_POINT_HEADING_DRIFT marks=0");
      expect("arch: NARRATIVE ANCHOR ROT → ARCH_DOC_ANCHOR_ROT (was dropped unread)", ["arch", "--json"], "anchor-rot", "architecture.md", "ARCH_DOC_ANCHOR_ROT marks=0");
      expect("arch: sub-process crash (rc=1, a stack, no section) → one marker (was a clean unit)", ["arch", "--json"], "crash", "architecture.md", "ARCH_DOC_DRIFT marks=1");
      expect("arch: a section line no shape matches → one marker naming the section (was a silently dropped finding)", ["arch", "--json"], "reworded", "architecture.md", "ARCH_DOC_DRIFT marks=1");
      expect("arch: a section header this parser does not know, beside a known one → the known one parsed, the unknown one a marker (was skipped as prose)", ["arch", "--json"], "new-section", "architecture.md", "ARCH_DOC_DRIFT marks=1");
      rmSync(join(fx2, ".claude/docs/architecture.md"));
      expect("arch: architecture.md absent → one marker (was a clean unit)", ["arch", "--json"], "clean", "architecture.md", "ARCH_DOC_DRIFT marks=1");
      w(".claude/docs/architecture.md", DOC);
      // B. lintNarrativeCountRefs — the SSOT sub-process, a vanished key, an absent doc, a pattern with no sentence
      expect("narrative: doc claims 'of 120 skills' vs SSOT 107 → NARRATIVE_COUNT_DRIFT, every pattern anchored (control)", ["meta", "--json"], "clean", "narrative count refs", "NARRATIVE_COUNT_DRIFT marks=0");
      expect("narrative: `list` crashes → one marker and no drift finding (was a clean unit)", ["meta", "--json"], "list-crash", "narrative count refs", "NARRATIVE_COUNT_DRIFT marks=1");
      expect("narrative: `list` renamed the `skills` key → that pattern is a marker; the drift it guarded is neither fabricated nor silently skipped", ["meta", "--json"], "list-renamed-key", "narrative count refs", "NARRATIVE_COUNT_DRIFT marks=1");
      w(".claude/docs/architecture.md", "This doc covers 1 of 120 skills. `/meta` (15 subcommands).\n");
      expect("narrative: a pattern matching 0 sentences across every doc → a marker beside the real drift (was silence)", ["meta", "--json"], "clean", "narrative count refs", "NARRATIVE_COUNT_DRIFT marks=1");
      w(".claude/docs/architecture.md", DOC);
      rmSync(join(fx2, ".claude/docs/state.md"));
      expect("narrative: a doc in the detector's list is absent → a marker (was `continue`)", ["meta", "--json"], "clean", "narrative count refs", "NARRATIVE_COUNT_DRIFT marks=1");
      w(".claude/docs/state.md", "\n");
      // E. lintAgentSkillPairing — an absent roster and an empty one (full-corpus run)
      expect("pairing: orphan agent present → AGENT_SKILL_PAIRING + AGENT_MODEL_PIN (control)", ["--json"], "clean", "agent-skill pairing", "AGENT_MODEL_PIN+AGENT_SKILL_PAIRING marks=0");
      rmSync(join(fx2, ".claude/agents"), { recursive: true });
      expect("pairing: .claude/agents absent → one marker (was a clean unit)", ["--json"], "clean", "agent-skill pairing", "AGENT_SKILL_PAIRING marks=1");
      mkdirSync(join(fx2, ".claude/agents"));
      expect("pairing: .claude/agents holds 0 agent files → one marker (was a clean unit)", ["--json"], "clean", "agent-skill pairing", "AGENT_SKILL_PAIRING marks=1");
      w(".claude/agents/orphan.md", ORPHAN);
      // F. lintMemoryEnvelopes — an entry under the skills root that cannot be stat'ed
      symlinkSync(join(fx2, ".claude/skills/nope"), join(fx2, ".claude/skills/dangling"));
      {
        const u = unit(run(["--json"]), "memory envelope debris");
        const got = u ? u.findings.filter((f) => f.unscanned === true && /cannot stat/.test(f.msg)).length : -1;
        arm("envelope: a dangling entry under the skills root → a cannot-stat marker (was a silent skip)", got === 1, `cannot-stat markers=${got}`);
      }
      rmSync(join(fx2, ".claude/skills/dangling"));
      // checks: — the frontmatter list form the rot check does not read
      w(".claude/skills/flowchk/SKILL.md", "---\nname: flowchk\ndescription: Use when testing the checks list parser.\nchecks: [tests/__nope__.test.ts]\n---\n# f\n");
      expect("checks: a flow-style list with items → CHECK_PATH_ROT marker (was silent)", ["flowchk", "--json"], "clean", "flowchk", "CHECK_PATH_ROT marks=1");
      w(".claude/skills/flowchk/SKILL.md", "---\nname: flowchk\ndescription: Use when testing the checks list parser.\nchecks: []\n---\n# f\n");
      expect("checks: `checks: []` → no finding, no marker (control)", ["flowchk", "--json"], "clean", "flowchk", "- marks=0");
      // the summary: the new line names the marked unit, Clean units excludes it, and the pre-commit contract line is unchanged
      {
        const r = run(["arch"], "crash");
        const lines = r.stdout.split("\n").filter((l) => /units|findings/i.test(l)).join(" | ");
        const ok = /^Unscanned units:\s+1 \(architecture\.md\)$/m.test(r.stdout) && /^Clean units:\s+0\/1$/m.test(r.stdout) && /^Total findings:\s+1$/m.test(r.stdout);
        arm("summary: `Unscanned units:` names the marked unit, `Clean units` excludes it, and the `Total findings:` line .githooks/pre-commit parses keeps its shape", ok, lines);
      }
      // ── the deletion matrix's survivors, the severity rule, the
      // enumerator's skipped entries and the parser's real-output gaps. A chmod arm is SKIPPED,
      // never passed, where this process can read a 000 path anyway (root, or a mode-ignoring filesystem).
      const sevs = (u) => (u ? [...new Set(u.findings.filter((f) => f.unscanned === true).map((f) => f.severity))].sort().join("+") || "-" : "<unit missing>");
      const cannot = (fn) => { try { fn(); return false; } catch { return true; } };
      chmodSync(join(fx2, ".claude/agents"), 0o000);
      if (cannot(() => readdirSync(join(fx2, ".claude/agents")))) {
        const u = unit(run(["--json"]), "agent-skill pairing");
        arm("pairing: .claude/agents unlistable (EACCES) → one ERROR marker (was a clean unit; a matrix survivor)", shape(u) === "AGENT_SKILL_PAIRING marks=1" && sevs(u) === "error", `${shape(u)} sev=${sevs(u)}`);
      } else arm("pairing: .claude/agents unlistable → SKIPPED, this process can list a 000 dir", true, "skipped");
      chmodSync(join(fx2, ".claude/agents"), 0o755);
      chmodSync(join(fx2, ".claude/agents/orphan.md"), 0o000);
      if (cannot(() => readFileSync(join(fx2, ".claude/agents/orphan.md")))) {
        const u = unit(run(["--json"]), "agent-skill pairing");
        arm("pairing: an agent file unreadable (EACCES) → the pairing error still fires and its model pin is an ERROR marker (a matrix survivor)", shape(u) === "AGENT_MODEL_PIN+AGENT_SKILL_PAIRING marks=1" && sevs(u) === "error", `${shape(u)} sev=${sevs(u)}`);
      } else arm("pairing: an agent file unreadable → SKIPPED, this process can read a 000 file", true, "skipped");
      chmodSync(join(fx2, ".claude/agents/orphan.md"), 0o644);
      rmSync(join(fx2, ".claude/agents"), { recursive: true });
      { const r = run(["--severity=fail"]); arm("severity: .claude/agents absent → --severity=fail rc=1 (the roster's markers inherit its error severity; was rc=0)", r.status === 1, `rc=${r.status}`); }
      w(".claude/agents/orphan.md", ORPHAN);
      rmSync(join(fx2, ".claude/docs/architecture.md"));
      { const r = run(["arch", "--severity=fail"]); arm("severity: architecture.md absent → --severity=fail rc=0 (a warn-only unit's marker stays warn; control)", r.status === 0, `rc=${r.status}`); }
      w(".claude/docs/architecture.md", DOC);
      rmSync(join(fx2, ".claude/hooks/warn-large-tracker-read.sh"));
      expect("band: the read guard absent → SPEC_OVER_READ_BAND marker on the skill (an inherited site; a matrix survivor)", ["meta", "--json"], "clean", "meta", "SPEC_OVER_READ_BAND marks=1");
      w(".claude/hooks/warn-large-tracker-read.sh", "TRACKER_THRESHOLD=51200\n");
      chmodSync(join(fx2, ".claude/skills/meta/MEMORY.md"), 0o000);
      if (cannot(() => readFileSync(join(fx2, ".claude/skills/meta/MEMORY.md")))) {
        const u = unit(run(["--json"]), "memory envelope debris");
        const got = u ? u.findings.filter((f) => f.unscanned === true && /cannot read it/.test(f.msg)).length : -1;
        arm("envelope: a memory file unreadable (EACCES) → a cannot-read marker (an inherited site; a matrix survivor)", got === 1, `cannot-read markers=${got}`);
      } else arm("envelope: a memory file unreadable → SKIPPED, this process can read a 000 file", true, "skipped");
      chmodSync(join(fx2, ".claude/skills/meta/MEMORY.md"), 0o644);
      symlinkSync(join(fx2, ".claude/skills/nope"), join(fx2, ".claude/skills/dangling"));
      { const u = unit(run(["--json"]), "dangling (unreadable skills entry)"); arm("enumerator: a dangling entry under the skills root → its own unit with one ERROR marker (was a stderr line and nothing in --json)", shape(u) === "MISSING_SKILL_MD marks=1" && sevs(u) === "error", `${shape(u)} sev=${sevs(u)}`); }
      rmSync(join(fx2, ".claude/skills/dangling"));
      expect("arch: a HYPHENATED unknown section beside a known one → the known one parsed, the unknown one a marker (the header class admits `-`)", ["arch", "--json"], "new-section-hyphen", "architecture.md", "ARCH_DOC_DRIFT marks=1");
      { const u = unit(run(["arch", "--json"], "crash"), "architecture.md"); const m = u ? u.findings.find((f) => f.unscanned === true) : null; arm("arch: a node-shaped crash (file:/// frame first) → the marker quotes the TypeError line, not the frame", !!m && /TypeError: Cannot read properties/.test(m.msg), m ? m.msg.slice(0, 160) : "<no marker>"); }
    } catch (e) {
      arm("arms ran to the end without throwing", false, `threw: ${e.message}`);
    } finally {
      if (fx2) { try { rmSync(fx2, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
    for (const [label, ok, why] of arms) console.log(`${ok ? "PASS" : "FAIL"}: UNSCANNED ${label}${ok ? "" : `  (${why})`}`);
  }

  console.log(`\nskill-lint --self-test: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

function lintSkill(name) {
  const skillDir = join(SKILLS_DIR, name);
  const skillFile = join(skillDir, "SKILL.md");
  const findings = [];

  if (!existsSync(skillFile)) {
    return { name, findings: [{ code: "MISSING_SKILL_MD", severity: "error", msg: "SKILL.md missing" }], lineCount: 0 };
  }

  const content = readFileSync(skillFile, "utf8");
  const lineCount = content.split("\n").length;

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    findings.push({ code: "MISSING_FRONTMATTER", severity: "error", msg: "no YAML frontmatter block" });
    return { name, findings, lineCount };
  }
  const fm = fmMatch[1];

  // Detect 'name:' field
  const nameMatch = fm.match(/^name:\s*(.+?)$/m);
  if (!nameMatch) {
    findings.push({ code: "MISSING_FRONTMATTER", severity: "error", msg: "frontmatter missing `name:` field" });
  }

  // Detect 'description:' field — supports multi-line `>-` block scalars
  // Capture either single-line `description: "..."` or block `description: >-\n  ...\n  ...\n` until next field
  let description = "";
  const singleLineDesc = fm.match(/^description:\s*(.+?)$/m);
  const blockDesc = fm.match(/^description:\s*>-?\n((?:\s+.+\n?)+)/m);
  if (blockDesc) {
    description = blockDesc[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  } else if (singleLineDesc) {
    description = singleLineDesc[1].replace(/^["']|["']$/g, "").trim();
  } else {
    findings.push({ code: "MISSING_FRONTMATTER", severity: "error", msg: "frontmatter missing `description:` field" });
  }

  // EMPTY_DESCRIPTION
  if (description && description.length < 20) {
    findings.push({ code: "EMPTY_DESCRIPTION", severity: "warn", msg: `description ${description.length} chars (<20)` });
  }

  // MISSING_TRIGGER — description should signal WHEN to use the skill via a "Use {when/at/before/after/for/during/whenever}..." framing
  // or the equivalent "When the user..." construction. These all give the harness a natural-language condition for routing.
  if (missingTrigger(description, fm)) {
    findings.push({ code: "MISSING_TRIGGER", severity: "warn", msg: "description lacks 'Use when/at/before/after/…' framing — improves harness skill match" });
  }

  // BLOATED_SKILL — the SKILL.md artifact is what loads on activation; references/ is the on-demand
  // tier meant to SHRINK the router, not license it to stay large. So >800 warns UNCONDITIONALLY (a
  // partial-decomposition stall — refs extracted but the router still >800 — is exactly the case the
  // detector exists to surface; the old `&& no references/` carve-out fired LEAST in that case). A
  // lighter >600 tier nudges a skill that is growing but hasn't started extracting; a small skill with
  // no refs stays silent.
  if (lineCount > 800) {
    const hasRefs = existsSync(join(skillDir, "references"));
    findings.push({ code: "BLOATED_SKILL", severity: "warn", msg: `${lineCount} lines${hasRefs ? " — router still >800 even with references/; extract more" : " without references/ subdirectory — consider progressive disclosure"}` });
  } else if (lineCount > 600 && !existsSync(join(skillDir, "references"))) {
    findings.push({ code: "BLOATED_SKILL", severity: "warn", msg: `${lineCount} lines without references/ subdirectory — consider progressive disclosure` });
  }

  // SPEC_OVER_READ_BAND — the BYTE axis. BLOATED_SKILL above counts LINES, and line count is a
  // ~3.5x-noisy proxy for bytes here (72 B/line in `summary`, 249 B/line in `post-compact`), so it
  // INVERTS at the top of the distribution. Re-measured 2026-09-13 after the arm fix above: 9 specs
  // exceed the read guard's ARM-A TRACKER_THRESHOLD and the line detector is SILENT on 6 —
  // including expert-review (159,961 B) and meta (130,046 B), the 2nd and 3rd largest specs in the
  // tree — while firing on summary (89,657 B). Zero findings in the other direction, so this is
  // purely additive. (Read "8 ... SILENT on 5" against SKILLMEM_THRESHOLD until the arm fix; the
  // dropped spec was one at 56,472 B, between the two constants.)
  // The READ plane closed 2026-09-04 (warn-large-tracker-read.sh ARM A); this is the AUTHORING
  // plane, never opened, and it is a size-DERIVED predicate, one plane earlier where extraction
  // is cheap. Upstream carries both axes in one linter (BLOATED_SKILL lines + SKILL_OVER_CODEX_CAP
  // bytes). An unreadable threshold is reported, never silently skipped — instrument failure lands
  // on the failing side.
  const band = readBandThreshold();
  const bytes = Buffer.byteLength(content, "utf8");
  if (band === null) {
    findings.push(unscanned("SPEC_OVER_READ_BAND", "cannot read TRACKER_THRESHOLD from .claude/hooks/warn-large-tracker-read.sh — the byte axis is UNMEASURED, not clean"));
  } else if (bytes > band) {
    findings.push({ code: "SPEC_OVER_READ_BAND", severity: "warn", msg: `${bytes} B exceeds the read guard's ${band} B advisory line (${(bytes / band).toFixed(1)}x) — past the guard's one-read band an unbounded Read returns a prefix and says so only in a trailing reminder, and the guard warns on it; extract to references/` });
  }

  // ORPHAN_REFERENCE — links to .claude/skills/X/ where X doesn't exist
  const skillRefs = content.matchAll(/`?\.?claude\/skills\/([a-z0-9-]+)`?/gi);
  for (const m of skillRefs) {
    const target = m[1];
    if (target === name) continue; // self-reference is fine
    if (target.endsWith("-")) continue; // trailing hyphen = glob capture truncated at `*` (e.g. `external-*/` → "external-")
    // A top-level FILE under .claude/skills/ is captured as a bare name (the regex stops at the
    // dot) and then fails a DIRECTORY check — a false orphan on a live doc. Measured 2026-09-13:
    // 1 live FP, .claude/skills/AUTHORING.md cited by one external-* skill.
    if (existsSync(join(SKILLS_DIR, `${target}.md`))) continue;
    const targetDir = join(SKILLS_DIR, target);
    if (!existsSync(targetDir)) {
      findings.push({ code: "ORPHAN_REFERENCE", severity: "warn", msg: `references nonexistent skill .claude/skills/${target}/` });
    }
  }

  // CHECK_PATH_ROT — a `checks:` frontmatter path that no longer resolves on disk
  // (guildhall-adopt 2026-07-05). A cited-but-nonexistent owned-check path is the
  // fictional-claim class. Core extracted to checksPathRot() for a committed regression control.
  // `checks: []` (no owned check yet) is honest — never a finding.
  for (const p of checksPathRot(fm, ROOT)) {
    findings.push({ code: "CHECK_PATH_ROT", severity: "warn", msg: `checks: path does not resolve: ${p} (owned-check binding rotted — fix the path or remove the entry)` });
  }
  const unparsedChecks = checksUnparsed(fm);
  if (unparsedChecks !== null) {
    findings.push(unscanned("CHECK_PATH_ROT", `checks: value not parsed — only \`checks: []\` and a block list (one \`  - path\` per line) are read, so \`${unparsedChecks.slice(0, 80)}\` was not checked for path rot; rewrite it as a block list`));
  }

  // ORPHAN_REFERENCE (file-level) — the AUTHORING.md-documented clause; see orphanFileRefs()
  // for the FP-engineering rationale. A rotted references/ link = the progressive-disclosure
  // tier silently unreachable (wired-but-inert, at the disclosure layer).
  for (const p of orphanFileRefs(content, skillDir, name)) {
    findings.push({ code: "ORPHAN_REFERENCE", severity: "warn", msg: `references file link does not resolve: ${p}${p.startsWith(".claude/") ? "" : " (relative to this skill)"}` });
  }

  return { name, findings, lineCount };
}

// ⛔ A MISSING SKILLS ROOT IS AN INSTRUMENT FAILURE, NOT A CLEAN CORPUS — AND IT MUST NOT REACH THE
// CALLER AS A STACK TRACE. An unguarded readdirSync here died with an unhandled `ENOENT ... scandir`
// on any tree lacking `.claude/skills`, and `.githooks/pre-commit` CANNOT TELL THAT FROM REAL
// FINDINGS: its gate is `LINT_EXIT -eq 0 && FINDING_COUNT -eq 0`, so a crash falls through to the
// same print block as a finding — by design, and correctly, since a crash has no `Total findings:`
// line. Measured 2026-09-13: a fixture without that directory printed 28 lines that were read as
// "the linter reported findings". Exit 2 is a DISTINCT path from 0 (clean) and 1 (errors), so the
// hook prints a named sentence instead of a stack.
// Pure, and armed DIRECTLY by --self-test, so the predicate and the sentence the exit path prints
// cannot drift apart.
function unusableRootReason(dir) {
  if (!existsSync(dir)) return `no skills root at ${dir}`;
  if (!statSync(dir).isDirectory()) return `skills root is not a directory: ${dir}`;
  return null;
}

// Exit 2 = INSTRUMENT FAILURE, and the code is load-bearing: rc=1 is `hasErrors` (see the exit at the
// foot of this file) and is also what `--severity=fail` returns, so a crash reported as 1 is
// byte-indistinguishable from "an error-severity finding exists" — the exact ambiguity this guard
// exists to remove. Split out of listSkills() 2026-09-13 so EVERY entry path that reads the corpus
// can call it, not just the enumerating one.
function assertUsableRoot() {
  const why = unusableRootReason(SKILLS_DIR);
  if (why) {
    console.error(
      `skill-lint: ${why} — nothing was scanned. This is an INSTRUMENT failure, not a clean corpus: ` +
        `the skills root is read relative to this script (../.claude/skills), so run the copy of the script that sits inside a full checkout.`,
    );
    process.exit(2);
  }
}

// Entries the enumerator could not stat (a dangling symlink, EACCES under an unreadable root). Each becomes
// its own UNSCANNED unit at ERROR severity in the main flow below: a skill that was not linted could have
// carried MISSING_FRONTMATTER or MISSING_SKILL_MD, and a stderr line alone left `--severity=fail` green and
// `Total findings` unchanged while a real error-severity finding went unread (measured:
// root 0444 → Skills scanned 0, rc 0, the same count line as the control).
const skippedEntries = [];

function listSkills() {
  assertUsableRoot();
  // ⛔ unusableRootReason() answers EXISTS-and-IS-A-DIRECTORY; it does NOT answer READABLE, and the
  // two reads below can each throw past it. Measured: a root at `chmod 000`
  // threw an unhandled `EACCES ... scandir` and a dangling symlink INSIDE the root threw an
  // unhandled `ENOENT ... stat` — both rc=1, both a stack, two lines below a guard whose whole
  // purpose was to replace that stack with a sentence. The guard was real and its coverage stopped
  // one statement short.
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR);
  } catch (err) {
    console.error(
      `skill-lint: cannot read skills root ${SKILLS_DIR} (${err.code ?? "unknown"}) — nothing was ` +
        `scanned. This is an INSTRUMENT failure, not a clean corpus.`,
    );
    process.exit(2);
  }
  return entries
    .filter((n) => {
      // A per-entry throw is a corpus ODDITY, not an instrument failure: skip it and NAME it, so a
      // dangling symlink neither kills the run nor disappears into a silently shorter scan.
      try {
        return statSync(join(SKILLS_DIR, n)).isDirectory();
      } catch (err) {
        console.error(
          `skill-lint: skipping unreadable entry ${n} (${err.code ?? "unknown"}) — not counted as a skill.`,
        );
        skippedEntries.push({ name: n, code: err.code ?? "unknown" });
        return false;
      }
    })
    .sort();
}

// ARCH_DOC_DRIFT and its siblings — runs scripts/architecture-counts.mjs check and parses its stderr BY
// SECTION. Added 2026-05-21 prevention stack ship; section-aware since 2026-09-14: the doc drift and
// the COMPARISON.md banner drift share one line template in the emitter (its two
// `Line ${d.line}: ${d.label} — claimed …` emits), so a regex over the WHOLE stderr labelled every banner
// drift ARCH_DOC_DRIFT — 36 to 40 logged drift lines at the audit,
// depending on the cut — and three of the five sections (EXTRA in listing, NARRATIVE ANCHOR ROT,
// APPENDIX C COVERAGE) had no regex at all and were dropped unread. Each section below names its
// header, the shapes of its lines, and the code each shape maps to. The header's declared count and
// every line inside the section are asserted: a line no shape matches, or a count the parsed lines do
// not reach, is an UNSCANNED marker — the string contract with the emitter is checked, never assumed.
// A section ends at the blank line the emitter prints after it.
const ARCH_DRIFT_LINE = /^\s+Line\s+(\d+):\s+(.+?)\s+—\s+claimed\s+(\d+),\s+actual\s+(\d+)/;
// Each shape carries its code as a `code: "..."` literal on purpose: .claude/skills/meta/SKILL.md's
// self-audit derives the code set with `grep -oE 'code: "[A-Z_]+"'` over this file, and the tuple form
// this table first shipped in hid all seven arch codes from it (20 → 12).
const ARCH_SECTIONS = [
  { name: "COUNT + NARRATIVE DRIFTS", header: /^COUNT \+ NARRATIVE DRIFTS \((\d+)\):/, exact: true, shapes: [
    { re: ARCH_DRIFT_LINE, code: "ARCH_DOC_DRIFT", msg: (m) => `Line ${m[1]}: ${m[2]} — claimed ${m[3]}, actual ${m[4]}. Run \`node scripts/architecture-counts.mjs fix\` to auto-correct.` },
  ] },
  { name: "COMPARISON.md BANNER DRIFTS", header: /^COMPARISON\.md BANNER DRIFTS \((\d+)\):/, exact: true, shapes: [
    { re: ARCH_DRIFT_LINE, code: "COMPARISON_BANNER_DRIFT", msg: (m) => `COMPARISON.md line ${m[1]}: ${m[2]} — claimed ${m[3]}, actual ${m[4]}. Run \`node scripts/architecture-counts.mjs fix\` to auto-correct.` },
  ] },
  // One listing-diff finding prints up to two lines (MISSING and EXTRA), so this section's declared count
  // is a floor on its lines, never an equality.
  { name: "LISTING DRIFTS", header: /^LISTING DRIFTS \((\d+)\):/, exact: false, shapes: [
    { re: /^\s+(\S+):\s+claimed\s+(\d+),\s+listed\s+(\d+)/, code: "ARCH_DOC_LISTING_DRIFT", msg: (m) => `${m[1]} listing: claimed ${m[2]}, actually listed ${m[3]} (run \`node scripts/architecture-counts.mjs check\` for details).` },
    { re: /^\s+(\S+)\s+MISSING\s+from\s+listing:\s+(.+)/, code: "ARCH_DOC_LISTING_MISSING", msg: (m) => `${m[1]} missing from listing: ${m[2]}` },
    { re: /^\s+(\S+)\s+EXTRA\s+in\s+listing:\s+(.+)/, code: "ARCH_DOC_LISTING_EXTRA", msg: (m) => `${m[1]} listed but not on disk: ${m[2]} — remove the stale entry or restore the file` },
  ] },
  { name: "NARRATIVE ANCHOR ROT", header: /^NARRATIVE ANCHOR ROT \((\d+)\):/, exact: true, shapes: [
    { re: /^\s+(\S+):\s+every narrative matcher for this key matched ZERO sentences/, code: "ARCH_DOC_ANCHOR_ROT", msg: (m) => `${m[1]}: architecture-counts' narrative matcher for this key matched ZERO sentences while architecture.md exists — the anchor sentence was reworded or removed and the count it guards is no longer re-checked; re-anchor the matcher in PATTERNS or retire the key from NARRATIVE_EXPECTED_KEYS` },
  ] },
  { name: "META ENTRY-POINT HEADING DRIFT", header: /^META ENTRY-POINT HEADING DRIFT \((\d+)\):/, exact: true, shapes: [
    { re: /^\s+meta\/SKILL\.md heading .*— claimed (\d+), bullets (\d+)/, code: "META_ENTRY_POINT_HEADING_DRIFT", msg: (m) => `meta/SKILL.md "Primary entry points" heading claims ${m[1]}; its list has ${m[2]} \`/meta\` bullets — hand-edit the heading's number` },
  ] },
  { name: "APPENDIX C COVERAGE", header: /^APPENDIX C COVERAGE \((\d+)\):/, exact: true, shapes: [
    { re: /^\s+L# cited in body but missing from Appendix C:\s+(.+)/, code: "ARCH_DOC_APPENDIX_C", msg: (m) => `L# cited in architecture.md's body but missing from Appendix C: ${m[1]}` },
    { re: /^\s+L# in Appendix C but not cited in body:\s+(.+)/, code: "ARCH_DOC_APPENDIX_C", msg: (m) => `L# in Appendix C but not cited in architecture.md's body: ${m[1]}` },
  ] },
];

// Any emitter section header has this shape; one ARCH_SECTIONS does not name is a section this parser
// cannot read — a marker, and its body is skipped rather than parsed as prose.
// The class admits `-`, `_` and `/` since a positive control showed that a hyphenated
// section beside a known one read as prose and dropped its finding under the first class.
const ARCH_ANY_HEADER = /^([A-Z][A-Za-z0-9 .+#/_-]*?) \((\d+)\):\s*$/;

// Pure: the emitter's stderr in; the findings its sections yield, the markers for what could not be read,
// and how many section headers (known or not) were seen at all. `sections === 0` on a non-zero exit is a
// crash or a reworded emitter, and the caller says so.
function parseArchCheckStderr(stderr) {
  const findings = [];
  const markers = [];
  const lines = stderr.split("\n");
  let sections = 0;
  for (let i = 0; i < lines.length; i++) {
    const sec = ARCH_SECTIONS.find((s) => s.header.test(lines[i]));
    if (!sec) {
      const any = lines[i].match(ARCH_ANY_HEADER);
      if (!any) continue;
      sections++;
      markers.push(`section ${any[1]}: not one this parser knows — its ${any[2]} finding(s) were not reported; add its line shapes to ARCH_SECTIONS`);
      for (i++; i < lines.length && lines[i].trim() !== ""; i++) { /* skip the unknown section's body */ }
      continue;
    }
    sections++;
    const declared = Number(lines[i].match(sec.header)[1]);
    let parsed = 0;
    let unparsed = 0;
    for (i++; i < lines.length && lines[i].trim() !== ""; i++) {
      let hit = null;
      for (const shape of sec.shapes) {
        const m = lines[i].match(shape.re);
        if (m) { hit = { code: shape.code, msg: shape.msg(m) }; break; }
      }
      if (hit) { findings.push({ code: hit.code, severity: "warn", msg: hit.msg }); parsed++; continue; }
      unparsed++;
      markers.push(`section ${sec.name}: no known line shape matches "${lines[i].trim().slice(0, 100)}" — the emitter's line moved, and the finding behind it was not reported`);
    }
    if (unparsed === 0 && (sec.exact ? parsed !== declared : parsed < declared)) {
      markers.push(`section ${sec.name}: declared ${declared} finding(s), parsed ${parsed} — lines this parser could not see`);
    }
  }
  return { findings, markers, sections };
}

function lintArchitectureDoc() {
  const findings = [];
  const docPath = join(ROOT, ".claude/docs/architecture.md");
  if (!existsSync(docPath)) {
    findings.push(unscanned("ARCH_DOC_DRIFT", ".claude/docs/architecture.md is absent — no count claim was checked (a missing doc is not a clean one)"));
    return { name: "architecture.md", findings, lineCount: 0 };
  }
  const lineCount = readFileSync(docPath, "utf-8").split("\n").length;
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/architecture-counts.mjs"), "check"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) {
    findings.push(unscanned("ARCH_DOC_DRIFT", `architecture-counts.mjs check could not be spawned (${r.error.code ?? r.error.message}) — no count claim was checked`));
    return { name: "architecture.md", findings, lineCount };
  }
  if (r.status === 0) return { name: "architecture.md", findings, lineCount }; // the emitter's own clean verdict
  const stderr = r.stderr ?? "";
  const { findings: parsed, markers, sections } = parseArchCheckStderr(stderr);
  findings.push(...parsed);
  if (sections === 0) {
    // A real node crash opens with a `file:///…` frame and the source line; the line that names the error
    // comes after the caret. Quote that one when it exists, else the first non-empty line.
    const stderrLines = stderr.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const first = (stderrLines.find((l) => /(^|\s)\w*Error\b/.test(l)) ?? stderrLines[0] ?? "").slice(0, 120);
    findings.push(unscanned("ARCH_DOC_DRIFT", `architecture-counts.mjs check exited ${r.status ?? `signal ${r.signal}`} and printed no drift section this parser knows — a crash, or a reworded emitter; first stderr line: "${first}"`));
  }
  for (const m of markers) findings.push(unscanned("ARCH_DOC_DRIFT", m));
  return { name: "architecture.md", findings, lineCount };
}

// NARRATIVE_COUNT_DRIFT detector (added 2026-07-01) — the filesystem-derivable prose-number
// phrasings the architecture-counts count-detector does NOT track ("of N skills" / "N distinct
// lessons" / "/meta (N subcommands)") rot silently across the doc corpus. This graduates the
// doc-content-audit Phase-1 "Number sweep" filesystem-derivable subset into a mechanical warn —
// auto-surfaced at /meta self-audit + pre-push, so it reaches NEITHER audit phase. Regex → SSOT →
// tolerance, plus a PLAUSIBILITY BAND [ssot*0.5, ssot*2] as the FP-guard: only a number within 2× of
// the SSOT is plausibly a STALE version of that count; a subset claim ("of 5 skills") falls outside
// the band and is ignored, while a stale total ("of 81 skills" when 87) is caught. SSOT via
// `architecture-counts list` (single source — no re-implemented compute).
// UNSCANNED sites (2026-09-14): a `list` that fails to run or to parse, a listed doc that is absent, an
// SSOT key that is missing or zero, and a pattern that matches nothing across every doc present each
// emit a marker where they used to `return`/`continue`. Two patterns were retired the same day because
// they matched 0 sentences in every doc: "top-N most-cited" and "at N/60" described the active-recall
// hot tier, parked since 2026-09-07 (path-scoped to the rules archive) — under the marker rule they
// would have marked every run. The three survivors matched 2, 1 and 1 sentences at 2026-09-14.
function lintNarrativeCountRefs() {
  const findings = [];
  const unit = () => ({ name: "narrative count refs", findings, lineCount: 0 });
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/architecture-counts.mjs"), "list"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let counts = null;
  let why = null;
  if (r.error) {
    why = `could not be spawned (${r.error.code ?? r.error.message})`;
  } else if (r.status !== 0) {
    const first = ((r.stderr ?? "").split("\n").find((l) => l.trim() !== "") ?? "").trim().slice(0, 120);
    why = `exited ${r.status ?? `signal ${r.signal}`}${first ? `: "${first}"` : ""}`;
  } else {
    try { counts = JSON.parse(r.stdout); } catch (e) { why = `printed something that is not JSON (${e.message})`; }
  }
  if (why === null && (counts === null || typeof counts !== "object")) why = "printed no object";
  if (why !== null) {
    findings.push(unscanned("NARRATIVE_COUNT_DRIFT", `architecture-counts.mjs list ${why} — no SSOT, so no count claim was checked`));
    return unit();
  }
  // [regex, SSOT key in `list`, tolerance, label] — all FP-guarded by the plausibility band in the loop below.
  const PATTERNS = [
    [/~?(\d+)\s+distinct\s+lessons\b/gi, "distinctLessons", 10, "distinct-lesson count (\"N distinct lessons\")"],
    [/(?:of|out of)\s+~?(\d+)\s+skills\b/gi, "skills", 5, "skill roster (\"of N skills\")"],
    [/\/meta`?\s+\((\d+)\s+subcommands\)/gi, "metaSubcommands", 0, "meta subcommand count (\"/meta (N subcommands)\")"],
  ];
  const docs = [
    ".claude/docs/architecture.md",
    ".claude/docs/architecture-overview.md",
    ".claude/docs/state.md",
    "CLAUDE.md",
    ".claude/rules/active-recall.md",
    ".claude/skills/AUTHORING.md",
  ].map((p) => join(ROOT, p));
  const bodies = [];
  for (const f of docs) {
    const rel = f.replace(ROOT + "/", "");
    if (!existsSync(f)) {
      findings.push(unscanned("NARRATIVE_COUNT_DRIFT", `${rel} is in this detector's doc list and absent — its claims were not checked; restore it or drop it from the list`));
      continue;
    }
    bodies.push([rel, readFileSync(f, "utf-8")]);
  }
  for (const [re, key, tol, label] of PATTERNS) {
    const ssot = counts[key];
    if (!Number.isFinite(ssot) || ssot <= 0) {
      findings.push(unscanned("NARRATIVE_COUNT_DRIFT", `${label}: SSOT key \`${key}\` is ${ssot === undefined ? "missing from" : `${JSON.stringify(ssot)} in`} \`architecture-counts.mjs list\` — the pattern was not checked`));
      continue;
    }
    let matched = 0;
    for (const [rel, body] of bodies) {
      for (const m of body.matchAll(re)) {
        matched++;
        const claimed = parseInt(m[1], 10);
        if (claimed < ssot * 0.5 || claimed > ssot * 2) continue; // plausibility band → not a stale version of this count
        if (Math.abs(claimed - ssot) > tol) {
          findings.push({
            code: "NARRATIVE_COUNT_DRIFT",
            severity: "warn",
            msg: `${rel}: ${label} claimed ${claimed} — actual ${ssot} (±${tol}). Update to the current count.`,
          });
        }
      }
    }
    if (matched === 0 && bodies.length > 0) {
      findings.push(unscanned("NARRATIVE_COUNT_DRIFT", `${label}: matched 0 sentences across ${bodies.length} doc(s) — the claim was reworded or removed, so this pattern guards nothing; re-anchor it or retire it`));
    }
  }
  return unit();
}

// AGENT_SKILL_PAIRING detector — every .claude/agents/<name>.md (except _agent-primer.md,
// the shared primer) MUST have a paired skill at .claude/skills/<name>/ containing a MEMORY.md.
// An "orphan agent" dispatches but loads no knowledge base — a real bug, so this ships at FINDING
// tier (error), not info. It is the INVERSE of wshobson's AGENT_NAME_COLLISION: our strict 1:1
// agent↔skill naming makes name collisions impossible, but nothing else enforced that the pairing
// EXISTS. Harness built-ins (general-purpose / Explore / Plan / statusline-setup / claude) are NOT
// files under .claude/agents/, so iterating the dir naturally excludes them — no allowlist needed.
// external-* pairs (external-wshobson-agents, …) follow the same 1:1 rule and pass.
// (/scout will feed new external-* agent+skill pairs into the corpus.)
// UNSCANNED (2026-09-14): an absent or unlistable .claude/agents, a roster of zero agent files, and an
// agent file that cannot be read each emit a marker where they used to return a clean unit — at ERROR
// severity, because this is the only corpus-level unit whose codes are error-severity and a live CI gate
// (55 agent files at 2026-09-14): a warn marker here would turn that gate off with a green build.
function lintAgentSkillPairing() {
  const findings = [];
  const unit = (n) => ({ name: "agent-skill pairing", findings, lineCount: 0, agentsScanned: n });
  if (!existsSync(AGENTS_DIR)) {
    findings.push(unscanned("AGENT_SKILL_PAIRING", ".claude/agents is absent — no agent was checked for a paired skill or a model pin (a missing roster is not a clean one)", "error"));
    return unit(0);
  }
  let names;
  try {
    names = readdirSync(AGENTS_DIR);
  } catch (e) {
    findings.push(unscanned("AGENT_SKILL_PAIRING", `.claude/agents cannot be listed (${e.code ?? e.message}) — no agent was checked`, "error"));
    return unit(0);
  }
  const agentFiles = names.filter((f) => f.endsWith(".md") && f !== "_agent-primer.md");
  if (agentFiles.length === 0) findings.push(unscanned("AGENT_SKILL_PAIRING", ".claude/agents holds 0 agent files — the pairing scan measured nothing", "error"));
  for (const f of agentFiles) {
    const name = f.replace(/\.md$/, "");
    const skillDir = join(SKILLS_DIR, name);
    if (!existsSync(skillDir)) {
      findings.push({ code: "AGENT_SKILL_PAIRING", severity: "error", msg: `agent .claude/agents/${f} has no paired skill .claude/skills/${name}/ (orphan agent — dispatches but loads no knowledge base)` });
    } else if (!existsSync(join(skillDir, "MEMORY.md"))) {
      findings.push({ code: "AGENT_SKILL_PAIRING", severity: "error", msg: `agent .claude/agents/${f} pairs to .claude/skills/${name}/ but it has no MEMORY.md (orphan agent — no knowledge base)` });
    }
    // AGENT_MODEL_PIN — see modelPinIssue() for rationale.
    let body;
    try {
      body = readFileSync(join(AGENTS_DIR, f), "utf8");
    } catch (e) {
      findings.push(unscanned("AGENT_MODEL_PIN", `.claude/agents/${f} cannot be read (${e.code ?? e.message}) — its model pin was not checked`, "error"));
      continue;
    }
    const pinIssue = modelPinIssue(body);
    if (pinIssue === "missing") {
      findings.push({ code: "AGENT_MODEL_PIN", severity: "error", msg: `agent .claude/agents/${f} has no model: line — write \`model: inherit\` so the launching seat picks the model; an omitted line leaves it to the harness default` });
    } else if (pinIssue) {
      findings.push({ code: "AGENT_MODEL_PIN", severity: "error", msg: `agent .claude/agents/${f} pins model: ${pinIssue} — agent definitions say \`model: inherit\`; the launching seat names a model per dispatch, and an explicit demand from you overrides it` });
    }
  }
  return unit(agentFiles.length);
}

// MEMORY_ENVELOPE_DEBRIS walker — every .claude/skills/*/MEMORY*.md and .claude/project-memory/*.md, the same
// population those two shell globs select (hidden names skipped, directories followed through symlinks). It must
// never throw: CI runs this script with --severity=fail, so an exception here would red the build over a
// warn-severity check. A directory it cannot list, a file it cannot read, or a population of zero is reported as
// an UNSCANNED finding — an unreadable corpus is not a clean one. See envelopeDebrisLines() for the rule.
// It reads the WORKING TREE from disk, never a commit, so while an edit to a memory file is uncommitted a local run
// and CI (which checks out a ref) legitimately disagree about that file.
// ⛔ A CI-red lane does exist and it is NOT this lint: --self-test's walker arm asserts ZERO UNSCANNED on the real
// roots, and the smoke suite asserts --self-test exits 0 (in the CI workflow, and in .githooks/pre-push
// whenever a hook or script changes). So a directory named *.md (or MEMORY*.md inside a skill dir), a file that
// cannot be read, or a dangling *.md / MEMORY*.md symlink reds that suite — all five shapes measured 2026-09-13
// against a fixture tree, each arriving here as an UNSCANNED finding — and since 2026-09-14 a dangling SKILL entry
// is an UNSCANNED finding too, not a silent skip. Reachability on this tree is zero (no symlink, no such directory, nothing unreadable under either
// root), and the direction is safe: a scan that could not run is reported, never passed for clean.
// The remedy the finding message names was measured on the same corpus: --sanitize cleared 28 of the 32 debris
// lines and changed no other line in 449 files; the 4 it left are three `</task-notification>"}`
// residues and one cut-off `<usage>` stub.
function lintMemoryEnvelopes(skillsDir = SKILLS_DIR, projectMemoryDir = PROJECT_MEMORY_DIR) {
  const findings = [];
  const rel = (p) => p.replace(ROOT + "/", "");
  const warn = (msg) => findings.push({ code: "MEMORY_ENVELOPE_DEBRIS", severity: "warn", msg });
  const list = (dir) => {
    try {
      return readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
    } catch (e) {
      findings.push(unscanned("MEMORY_ENVELOPE_DEBRIS", `${rel(dir)}: cannot list it (${e.code ?? e.message}) — the memory files under it were not checked`));
      return [];
    }
  };
  // One array per root, so --self-test can pin EACH root above zero. A name-pattern drift that empties one root
  // lists fine, raises no UNSCANNED finding, and leaves the total above zero on the other root's files.
  const skillFiles = [];
  for (const d of list(skillsDir)) {
    let isDir = false;
    try {
      isDir = statSync(join(skillsDir, d)).isDirectory();
    } catch (e) {
      // a dangling entry is not a skill directory (listSkills() names and skips it; this walker must not throw) —
      // and it was not walked for MEMORY*.md, which is a marker, not a silence (2026-09-14)
      findings.push(unscanned("MEMORY_ENVELOPE_DEBRIS", `${rel(join(skillsDir, d))}: cannot stat it (${e.code ?? e.message}) — not walked for MEMORY*.md`));
    }
    if (!isDir) continue;
    for (const n of list(join(skillsDir, d))) {
      if (/^MEMORY.*\.md$/.test(n)) skillFiles.push(join(skillsDir, d, n));
    }
  }
  const projectMemoryFiles = [];
  for (const n of list(projectMemoryDir)) {
    if (n.endsWith(".md")) projectMemoryFiles.push(join(projectMemoryDir, n));
  }
  const files = [...skillFiles, ...projectMemoryFiles];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch (e) {
      findings.push(unscanned("MEMORY_ENVELOPE_DEBRIS", `${rel(f)}: cannot read it (${e.code ?? e.message})`));
      continue;
    }
    for (const { line, tokens } of envelopeDebrisLines(text)) {
      // The SHAPE is all this can observe. The provenance the message used to assert — "a transcript-recovery
      // paste" — is not in evidence on the line, and this commit is itself a reason for prose about these tags.
      warn(
        `${rel(f)}:${line} ${[...new Set(tokens)].join(" ")} — harness envelope text at a line edge, or before an index row's \` | \` / \` → \`. ` +
          `Strip it with \`node scripts/memory-tier-split.mjs --sanitize ${rel(f)}\` (it removes only a </result> at a line's very end, a whole line of the form <usage><subagent_tokens>N</subagent_tokens>...</usage>, and a line that is exactly </task-notification>), by hand for the rest, a \`"}\` residue or a cut-off <usage> stub included; ` +
          `--roll, --heal and --shard never run that sanitizer, so a closer on an entry's first line or Revisit line can be copied into its router's ` +
          `digest row as well, and reports again until that row is rebuilt from the cleaned entry`,
      );
    }
  }
  if (files.length === 0) findings.push(unscanned("MEMORY_ENVELOPE_DEBRIS", "UNSCANNED: 0 memory files found — the envelope scan measured nothing"));
  return {
    name: "memory envelope debris",
    findings,
    lineCount: 0,
    filesScanned: files.length,
    filesByRoot: { skills: skillFiles.length, projectMemory: projectMemoryFiles.length },
  };
}

// Special targets that aren't skills
const SPECIAL_TARGETS = new Set(["architecture", "arch"]);

// ⛔ THE NAMED-SKILL PATH MUST CHECK THE ROOT TOO — it never calls listSkills(), so before 2026-09-13
// the guard was unreachable from here and the tool FABRICATED a corpus result on a tree with no
// `.claude/skills` (measured): `skill-lint.mjs meta` → rc=0 with
// "[ERROR] MISSING_SKILL_MD · Skills scanned: 1 · Total findings: 1"; with `--severity=fail` → rc=1,
// indistinguishable from a real error finding; with `--json` → a document asserting a finding about a
// skill that does not exist. An instrument failure rendered as a corpus result with a plausible
// number attached — the same class as the two above, on the third path. SPECIAL_TARGETS are exempt
// by construction: `architecture`/`arch` read the doc, never the skills root.
let skills;
if (targetSkill && !SPECIAL_TARGETS.has(targetSkill)) {
  assertUsableRoot();
  skills = [targetSkill];
} else {
  skills = targetSkill ? [] : listSkills();
}
const results = skills.map(lintSkill);
for (const { name, code } of skippedEntries) {
  results.push({
    name: `${name} (unreadable skills entry)`,
    findings: [unscanned("MISSING_SKILL_MD", `.claude/skills/${name} cannot be stat'ed (${code}) — not linted, so any finding it carries, error severity included, is unknown; remove the dangling entry or restore its permissions`, "error")],
    lineCount: 0,
  });
}

// The narrative-count check runs once (full corpus, or `meta` explicitly — the legacy home of the
// numbering detectors it used to sit beside; those are retired, see the header).
if (!targetSkill || targetSkill === "meta") {
  results.push(lintNarrativeCountRefs());
}

// Architecture-doc drift check runs once (only when linting full corpus or arch explicitly).
if (!targetSkill || SPECIAL_TARGETS.has(targetSkill)) {
  results.push(lintArchitectureDoc());
}

// Agent↔skill pairing check runs once on full-corpus lint (corpus-level invariant, not per-skill).
// The memory-envelope scan is corpus-level too: its population is every skill's MEMORY*.md plus project-memory.
if (!targetSkill) {
  results.push(lintAgentSkillPairing());
  results.push(lintMemoryEnvelopes());
}

if (jsonOutput) {
  console.log(JSON.stringify(results, null, 2));
} else {
  let totalFindings = 0;
  let cleanSkills = 0;
  let infoSuppressed = 0;
  const byCode = {};
  for (const r of results) {
    // info-severity findings (benign immutable-ID gaps, dual-index) are suppressed by
    // default — they are not actionable and drown the real signal. `--info` lists them.
    const shown = showInfo ? r.findings : r.findings.filter((f) => f.severity !== "info");
    infoSuppressed += r.findings.length - shown.length;
    if (shown.length === 0) {
      cleanSkills++;
      continue;
    }
    totalFindings += shown.length;
    console.log(`\n${r.name} (${r.lineCount} lines):`);
    for (const f of shown) {
      const prefix = f.severity === "error" ? "ERROR" : f.severity === "warn" ? "WARN " : "INFO ";
      console.log(`  [${prefix}] ${f.code}: ${f.msg}`);
      byCode[f.code] = (byCode[f.code] || 0) + 1;
    }
  }
  console.log(`\n--- skill-lint summary ---`);
  // results[] carries the real skills PLUS the appended corpus-level pseudo-units
  // (narrative/arch/pairing/memory-envelope) — count them separately or the drift
  // detector's own summary has a count drift.
  // Skipped entries are units too (one ERROR marker each, see listSkills), but they are not corpus-level
  // checks — name them apart so a 0444 root reads "0 (+ 4 corpus-level checks, 2 unreadable entries)"
  // rather than inflating the check count. No consumer parses this line (swept 2026-09-14); the
  // contract line is `Total findings:` below.
  const corpusLevel = results.length - skills.length - skippedEntries.length;
  const skippedNote = skippedEntries.length ? `, ${skippedEntries.length} unreadable entr${skippedEntries.length === 1 ? "y" : "ies"}` : "";
  console.log(`Skills scanned:   ${skills.length}  (+ ${corpusLevel} corpus-level checks${skippedNote})`);
  // A clean unit prints nothing, so the scan's population is printed here: a PARTIAL walk (a moved root, a drifted
  // name pattern) would otherwise look exactly like a clean one. A zero-file walk is already an UNSCANNED finding.
  const memoryUnit = results.find((r) => r.filesScanned !== undefined);
  if (memoryUnit) console.log(`Memory files:     ${memoryUnit.filesScanned} scanned for envelope debris`);
  console.log(`Clean units:      ${cleanSkills}/${results.length}`);
  console.log(`Units w/ findings: ${results.length - cleanSkills}`);
  // A marked unit is one that could NOT look (header § THE UNSCANNED CONVENTION). Its marker is a warn
  // finding, so it is already outside `Clean units`; it is named here so a reader can tell "found N
  // things" from "could not check". The `Total findings:` line below is the string contract
  // .githooks/pre-commit parses — its shape does not change.
  const unscannedUnits = results.filter((r) => r.findings.some((f) => f.unscanned === true));
  console.log(`Unscanned units:  ${unscannedUnits.length}${unscannedUnits.length ? ` (${unscannedUnits.map((r) => r.name).join(", ")})` : ""}`);
  console.log(`Total findings:   ${totalFindings}`);
  if (infoSuppressed > 0 && !showInfo) {
    console.log(`Informational:    ${infoSuppressed} suppressed (benign gaps / dual-index — pass --info to list)`);
  }
  if (totalFindings > 0) {
    console.log(`By code:`);
    for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
    }
  }
}

if (failOnFindings) {
  const hasErrors = results.some((r) => r.findings.some((f) => f.severity === "error"));
  if (hasErrors) process.exit(1);
}
