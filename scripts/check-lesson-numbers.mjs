#!/usr/bin/env node
// check-lesson-numbers.mjs — hard gate against a DUPLICATE or REUSED `L#` in the meta lesson ledger.
//
// WHY (2026-07-10): `L#` is a monotonic counter on a SHARED append-only file with NO
// ALLOCATION PROTOCOL. `architecture-counts.mjs list -> maxL` is a READ, not a reservation. Four
// sessions codified inside one minute, each read `maxL`, each took `maxL+1` — 7 lessons landed on
// 3 numbers (one taken three times, two twice). Nothing was lost (append-only + first-commit-wins
// held), but every citation of those numbers was ambiguous and the file accepted all three
// SILENTLY. This turns that silent corruption into a red at the push boundary.
//
// TWO FAILURE MODES, both fatal:
//   (1) DUPLICATE  — the same L# declared twice in MEMORY.md
//   (2) GAP-REUSE  — an L# declared in MEMORY.md that is also retired in RETIRED.md
//                    (RETIRED.md: "numbers are never reassigned" — monotonic-ID => monotonic-time)
//
// COVERAGE IS THE HARD PART, and this guard reports its own blind spots rather than hiding them.
// The narrow regex every session used that night (`^## <date> — L(\d+):`) was colon-only and
// date-required — blind to 67 of the 367 headings PRESENT AT THAT TIME (a measurement taken
// 2026-07-10, not a constant; the corpus is at 502 headings as of the same day and still growing).
// It gave the right answer BY LUCK.
//
// ── THE FAIL-OPEN THIS GUARD SHIPPED WITH, AND WHY (2026-07-10) ──
// v1 used PUNCTUATION as a proxy for declaration-hood: a `:` `(` or `—` after the number meant
// declaration; a letter meant annotation; anything else was silently DROPPED. Three real shapes
// therefore reached `main` with rc=0 on an injected duplicate:
//     `## 2026-07-10 — L<N> duplicate, no colon`   (letter after the number  → read as annotation)
//     `## 2026-07-10 - L<N>: duplicate`            (ASCII hyphen date-sep    → matched NOTHING)
//     `## 2026-07-10 – L<N>: duplicate`            (en-dash, macOS auto-subs → matched NOTHING)
// and the last two evaded the `unclassified:` surface too. **A detector whose ambiguous branch
// defaults to DROP fails open.** The guard had inherited the exact property its own header documents.
//
// ── THE FIX, AND WHY NOT THE OBVIOUS ONE ──
// The obvious inversion ("anything that isn't an annotation IS a declaration") was MEASURED against
// the real corpus and manufactures TWO false duplicates — `## … L<N> + L<M> RECURRENCE …` and
// `## … L<N>/L<M> recurred …` are multi-L# annotations whose second number is declared elsewhere.
// A hard gate that cries wolf gets `SKIP_LESSON_NUMBER_CHECK=1` set permanently, which is a worse
// failure than the one it fixes. So the taxonomy is THREE-way, and the ambiguous branch FAILS CLOSED:
//   DECLARATION — a recognized terminator (`:` `(` any dash, or end-of-line) follows the number.
//   ANNOTATION  — the annotation vocabulary appears ANYWHERE in the heading tail (closed set of 5
//                 stems, empirically complete over 502 headings). Annotations do not CLAIM a number.
//   AMBIGUOUS   — anything else. It CLAIMS its number (so a duplicate is caught) AND is printed.
// Residual, closed by the orphan check: a colon-less declaration whose title happens to contain an
// annotation stem would read as an annotation. But an annotation must annotate an EXISTING lesson —
// so an annotation whose number is declared NOWHERE is surfaced as `orphan annotation`.
//
// Deliberately NOT matched (real annotations — matching them would be a false positive):
//   `## 2026-04-21 — L<N> corollary: ...`   `## 2026-04-22 — L<N> recurrence + ...`
//   `## 2026-05-24 — L<N> EXTENSION: ...`   `## Panel Playbook — ... (L<N>-override)`
//
// Usage:  node scripts/check-lesson-numbers.mjs [memoryPath] [retiredPath]
//         node scripts/check-lesson-numbers.mjs --self-test
// Exit 0 = clean (prints maxL + next free). Exit 1 = duplicate or gap-reuse.

import { readFileSync, existsSync, realpathSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath, join as joinPath } from "node:path";
import { tmpdir } from "node:os";

// ENTRYPOINT GUARD (2026-07-10). Without it, `import { scan }` ran the CLI: it read the
// importer's `argv[2]` as a memory path, printed the guard's report into the importer's stdout ahead
// of its own output, and — on a DIRTY ledger — called `process.exit(1)`, killing the importer before
// its first line. A dirty ledger is the ONLY state in which anyone imports `scan()`. It therefore
// worked in every test and died in the exact case it exists for. This shipped in the same hour as
// the meta lesson "read the instrument, don't model it", which the bug made impossible to follow.
//
// ⚠ THE NAIVE FORM OF THIS GUARD FAILS OPEN THROUGH A SYMLINK, and this is a HARD-BLOCK gate.
// Node RESOLVES symlinks when computing `import.meta.url`; `process.argv[1]` keeps whatever the
// caller typed. So `import.meta.url === pathToFileURL(process.argv[1]).href` is FALSE when the script
// is reached through a symlinked path → `IS_MAIN` false → `main` silently never runs → **rc=0 on a
// dirty ledger.** Measured: `node /tmp/link/scripts/check-lesson-numbers.mjs <dirty>` → rc=0, while
// the relative form `.githooks/pre-push:112` uses → rc=1. Latent today, not exploitable, and exactly
// the shape of every other bug in this file's history: a remedy tested against the bug it fixed and
// against nothing else (a meta lesson: a reviewer's remedy is a hypothesis).
// Compare on the REALPATH, and fall back to the naive compare rather than to `false` — for a gate,
// an undecidable entrypoint must never resolve to "don't run".
const IS_MAIN = (() => {
  const invoked = process.argv[1];
  if (!invoked) return false;                                   // `node -e` / REPL → library mode
  try {
    if (import.meta.url === pathToFileURL(realpathSync(invoked)).href) return true;
  } catch { /* argv[1] not a real path — fall through to the naive compare */ }
  return import.meta.url === pathToFileURL(invoked).href;
})();

// ⚠ THIRD FAIL-OPEN OF THE SAME FAMILY (2026-07-31) — the defaults were CWD-RELATIVE, so the gate
// read nothing and PASSED from any directory but the repo root. Measured:
//   cd scripts && node ../scripts/check-lesson-numbers.mjs
//   → "lesson-numbers: .claude/skills/meta/MEMORY.md not found — nothing to check"   rc=0
// Git invokes `.githooks/pre-push` from the repo root, so this was LATENT under the hook — but every
// other composing caller (a script, a smoke harness, a manual run from a subdir) got a green verdict
// on an unread ledger, indistinguishable in the output from a clean one. Sibling of the symlink
// fail-open above: same shape, same file, same "remedy tested against its own bug and nothing else".
// Anchor to the SCRIPT's own location, never the caller's cwd.
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const META_DIR = resolvePath(REPO_ROOT, ".claude/skills/meta");
const MEMORY_DEFAULT = resolvePath(META_DIR, "MEMORY.md");
const RETIRED_DEFAULT = resolvePath(META_DIR, "RETIRED.md");

// ⚠ FIFTH FAIL-OPEN OF THE SAME FAMILY, PRE-EMPTED (2026-08-06, PHASE 1 of the meta memory
// archive split). The default above read ONE file. The ledger is being split into a router
// `MEMORY.md` + dated `MEMORY-ARCHIVE-<from>-<to>.md` shards, and on the DAY that lands, a
// single-file default stops seeing the archived tier — silently. It does not error and it does
// not under-report the SUMMARY: `maxL` stays correct (the newest heading is in the hot tier), so
// the mint keeps working and the verdict line keeps looking right. What dies is DUPLICATE and
// GAP-REUSE detection over every archived declaration — MEASURED at 600 of 792 on the simulated
// split. A seat that hand-picks an archived L# would ship a collision at rc=0, which is the exact
// silent corruption this whole file exists to turn into a red.
//
// So the default is a UNION over the tier family, not a path. Concatenated in FILENAME order,
// which is also APPEND order: `-` (0x2D) sorts before `.` (0x2E), so every `MEMORY-ARCHIVE-*.md`
// precedes `MEMORY.md` and the hot tier lands last, exactly as the entries were written.
//
// The union is what keeps THREE detectors whole, not one:
//   - duplicates / gap-reuse  — a number declared in two different tiers still collides.
//   - orphanAnnotations       — an annotation in the hot tier whose lesson body has been archived
//                               is NOT an orphan; without the union every such pair warns forever,
//                               and a warning that is always wrong is a warning nobody reads.
//   - listDeclaredNumbers     — the legacy list-form era (`## Lessons`) is the LARGEST
//                               single block and is going to the archive. It feeds ONLY the
//                               orphan-suppression set (see LIST_DECL_RE), so it must be inside
//                               whatever text `scan()` receives or the suppression evaporates.
// Joined with "\n" deliberately: a shard whose last byte is not a newline would otherwise glue its
// final heading to the next shard's first one, destroying BOTH (`## L<N>: a## L<M>: b` is one line
// and matches neither). This is a concatenation of independent files, not of a stream.
const MEMORY_TIER_RE = /^MEMORY.*\.md$/;
export function memoryTierPaths(dir = META_DIR) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];   // caller fails CLOSED on an empty set — see the main block.
  }
  return names.filter((f) => MEMORY_TIER_RE.test(f)).sort().map((f) => resolvePath(dir, f));
}
// ── RULES-CORPUS IN-USE FLOOR (2026-08-15) ────────────────────────────────────
// MEASURED: this file's corpus is `.claude/skills/meta/MEMORY*.md` ONLY, so a lesson whose BODY is
// homed in `.claude/rules/` never raises `maxL` — not even after it is committed. The documented
// fallback allocator (read maxL, take maxL+1) therefore re-issues a live number DETERMINISTICALLY,
// at any spacing, with both seats fully compliant with the written procedure. That is not a race;
// there is no window to lose. Measured 2026-08-14: a session appended three DIFFERENT lessons under
// three numbers whose bodies already sat in `copy.md` + `bash-environment.md`; for ~2h
// every seat held two lessons per number, resolving by which file it grepped (theirs moved).
// At the time of this fix the invisible set is exactly {1210, 1211} — both under the
// ledger floor, so THIS CHANGE IS A NO-OP TODAY and cannot be validated by running it. See the
// discriminating self-test arm, which constructs the misalignment the live corpora do not have.
//
// WHY OVER-MATCHING IS SAFE — and the reason is STRONGER than "it can only raise a floor", which is
// what the first version of this comment said (corrected since, and verified here).
// The trailing `\b` cannot match an over-long token AT ALL: `L12345` → `[]`, not `[1234]`, because
// `\d{1,4}` backtracks and no boundary is ever found. So a truncation shape contributes NOTHING.
// The distinction is load-bearing: "over-matching is harmless" would still PERMIT a catastrophic
// raise; "the pattern cannot match it" forecloses one. Corpus at the time of writing: 219 distinct,
// all six top values genuine recent lessons.
//   RESIDUAL, deliberately UNGUARDED: the guarantee holds while every 4-digit `L`-token in
//   `.claude/rules/` is a real lesson number. An `L` written directly before a date such as
//   `2026-08-15` WOULD match and raise the floor to 2026 (measured; no such token exists today).
//   Left unguarded because that failure is LOUD — the next status line's `next free` jumps to the
//   year after and anyone looking sees it — whereas the under-count this
//   fix closed was silent for as long as it existed. Direction of failure decides whether a
//   mechanism is owed, and this one announces itself.
//
// SCOPE — deliberately the FLOOR and nothing else. These numbers do NOT enter `declared`, so they
// can raise no DUPLICATE and no GAP-REUSE finding: a rules-homed citation is evidence that a number
// is SPOKEN FOR, never that it was declared here. The question this answers is the allocator's
// ("is this number in use anywhere?"), not the ledger's ("is it declared in canonical form?") —
// the same split `lesson-mint status` already makes. Consequence: `maxL` and `next free` can now
// legitimately differ by more than 1, which the verdict line labels rather than hides.
const RULES_DIR = resolvePath(REPO_ROOT, ".claude/rules");
// 2026-08-17: lesson bodies ALSO land in the always-loaded
// ROOT specs (AGENTS.md holds at least one) and the Band-O file — a corpus
// scoped to .claude/rules/ alone reads such a lesson as free and RE-ISSUES its
// number (the collision class, new home). Same weak in-use predicate as
// the rules dir, same SAFE over-match direction (cost = a skipped free number).
// 2026-09-03: the orchestrator-only doctrine now lives in SEVERAL files under .claude/orchestrator/
// (conventions / commit-doctrine / session-doctrine, delivered at SessionStart); enumerate the
// DIRECTORY, never a fixed list, or a lesson body moved there reads as free and gets re-issued
// (the collision class again).
const ORCH_DIR = resolvePath(REPO_ROOT, ".claude/orchestrator");
function orchestratorFiles() {
  try { return readdirSync(ORCH_DIR).filter((n) => n.endsWith(".md")).map((n) => `.claude/orchestrator/${n}`); }
  catch { return []; }
}
const EXTRA_INUSE_FILES = ["AGENTS.md", "CLAUDE.md", ...orchestratorFiles()];
const L_NUM_RE = /\bL(\d{1,4})\b/g;
export function rulesCorpusNumbers(dir = RULES_DIR) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    names = [];   // absent rules dir ⇒ no floor contribution from it; never throws, never lowers the floor.
  }
  const out = new Set();
  for (const f of names.filter((n) => n.endsWith(".md"))) {
    let text;
    try { text = readFileSync(resolvePath(dir, f), "utf8"); } catch { continue; }
    for (const m of text.matchAll(L_NUM_RE)) out.add(Number(m[1]));
  }
  // Only for the REAL corpus — a fixture dir passed by the self-test stays
  // hermetic (the extra files would contaminate its expected set).
  if (dir === RULES_DIR) {
    for (const rel of EXTRA_INUSE_FILES) {
      let text;
      try { text = readFileSync(resolvePath(REPO_ROOT, rel), "utf8"); } catch { continue; }
      for (const m of text.matchAll(L_NUM_RE)) out.add(Number(m[1]));
    }
  }
  return [...out];
}
export function readMemoryTiers(paths) {
  return paths.map((p) => readFileSync(p, "utf8")).join("\n");
}

// Any dash a human or an autocorrect can produce: em (U+2014), en (U+2013), ASCII hyphen.
const DASH = "[\\u2014\\u2013-]";
const DATE = `(?:\\d{4}-\\d{2}-\\d{2}\\s*${DASH}\\s*)?`;
// Markdown emphasis is decoration, never semantics: `## **L<N>**:` is a declaration.
const stripEmphasis = (s) => s.replace(/[*_`]/g, "");

// DECLARATION: a recognized terminator follows the number — `L<N>:` `L<N> (` `L<N> —` `L<N>` at EOL.
const DECLARATION_RE = new RegExp(`^## ${DATE}L(\\d+)\\s*(?:[:(]|${DASH}|$)`);
// Retired archive form: `## L<N> — retired YYYY-MM-DD — reason`
const RETIRED_RE = new RegExp(`^## L(\\d+)\\s*${DASH}`);
// An L-number sitting in DECLARATION position, whatever follows it.
const DECL_POSITION_RE = new RegExp(`^## ${DATE}L(\\d+)(.*)$`);
// The annotation vocabulary — a CLOSED set, verified complete over all 502 headings. Scanned across
// the whole tail (not just its head) so multi-L# forms `L<N> + L<M> RECURRENCE` / `L<N>/L<M> recurred`
// classify correctly. `recurr\w*` covers recurrence/recurred/recurring.
// `amendment\w*` added 2026-07-15 (surfaced by a later check): the `L### AMENDMENT: …` form
// entered the corpus 2026-07-13, AFTER this set was declared "complete over 502 headings" — it AMENDS an
// existing lesson (like corollary/extension), so it is an annotation, NOT a re-declaration. Without it,
// two `L<N> AMENDMENT` headings were false-positive duplicates (a colon-less tail → ambiguous →
// claimed the number). "verified complete over N headings" is a measurement, not a constant (this file's
// own header) — the corpus grew a new annotation stem, and the closed set grows with it.
const ANNOTATION_RE = /\b(corollar\w*|recurr\w*|extension|reinforce\w*|occurrence|amendment\w*)\b/i;

// LIST-FORM declarations (`89. **Memory possession ≠ …**`) — an earlier era of MEMORY.md.
// THIS SET IS USED ONLY TO SUPPRESS THE ORPHAN WARNING, NEVER TO FEED DUPLICATE DETECTION.
// Why the asymmetry: the pattern OVER-MATCHES — it also hits numbered BULLETS inside lesson prose,
// so 1/2/3 recur up to ten times. Over-matching a WARNING-suppression set costs a missed warning;
// over-matching the GATE manufactures false duplicates, and a hard gate that cries wolf gets
// SKIP_LESSON_NUMBER_CHECK=1 set permanently — a worse, quieter failure than the one it fixes.
//
// ⚠ CONSEQUENCE, KNOWN: a REUSE of a list-ONLY number
// currently SHIPS at rc=0 (measured on four such numbers). Measured with this module's own scan(),
// not a re-implementation of it: 339 raw lines → 304 distinct numbers → 19 also carry a heading
// (so the gate already blocks those) → TRUE BLIND SET = 285, and it is NOT contiguous. An earlier
// comment here said "339 declarations" over one contiguous range: 339 was a LINE count lifted
// from a mail whose author explicitly declined to stand behind it, and the range claim
// contradicted this very paragraph's own 19-dual-declared list (a meta lesson's reinforcement).
// The collision under HISTORY below was caught only because its number lies above the list-form
// range — both its declarations were heading-form.
// Closing it needs a region-bounded regex + union-by-NUMBER + RED-authored self-test rows.
const LIST_DECL_RE = /^(\d+)\.\s+\*\*/;
function listDeclaredNumbers(text) {
  const s = new Set();
  for (const l of text.split("\n")) { const m = LIST_DECL_RE.exec(l); if (m) s.add(Number(m[1])); }
  return s;
}

function headings(text) {
  return text.split("\n").filter((l) => l.startsWith("## ")).map(stripEmphasis);
}

// GRANDFATHERED baseline (lint-baseline practice): duplicates that PRE-DATE this guard.
// EMPTY, and it should stay that way. The mechanism is retained (and self-tested) so a future
// baseline can be grandfathered without weakening the gate — the exemption is EXACT-COUNT, so a
// grandfathered number that gains one more declaration still FAILS.
//
// HISTORY: a real collision was found on this guard's FIRST live run — one number declared twice, both
// codified 2026-06-23 and unnoticed for two weeks, because every duplicate-check anyone ran was
// colon-only and blind to the dash form `## L<N> — title`. Repaired: the later file position
// ceded to the next free number, and the two real citations were repointed.
const GRANDFATHERED = new Map();

export function scan(memoryText, retiredText = "", grandfathered = GRANDFATHERED, inUse = []) {
  const declared = new Map(); // n -> [heading, ...]   (declarations + ambiguous claims)
  const ambiguous = [];       // claimed its number, but we could not name its form — printed
  const annotations = [];     // {n, h} — commentary on an existing lesson; claims nothing

  for (const h of headings(memoryText)) {
    const d = DECLARATION_RE.exec(h);
    if (d) {
      const n = Number(d[1]);
      if (!declared.has(n)) declared.set(n, []);
      declared.get(n).push(h);
      continue;
    }
    const p = DECL_POSITION_RE.exec(h);
    if (!p) continue; // no L-number in declaration position — not ours to judge
    const [, num, tail] = p;
    const n = Number(num);
    if (ANNOTATION_RE.test(tail)) { annotations.push({ n, h }); continue; }
    // AMBIGUOUS => FAIL CLOSED. It claims the number (a duplicate is caught) and it is printed.
    if (!declared.has(n)) declared.set(n, []);
    declared.get(n).push(h);
    ambiguous.push(h);
  }

  const retired = new Set();
  for (const h of headings(retiredText)) {
    const r = RETIRED_RE.exec(h);
    if (r) retired.add(Number(r[1]));
  }

  // An annotation annotates an EXISTING lesson. One whose number is declared nowhere is either a
  // typo or a colon-less DECLARATION mis-read as an annotation — the one residual of the vocabulary
  // heuristic. Surface it rather than let it hide. A number declared in the legacy LIST form counts
  // as declared for THIS check only (see LIST_DECL_RE) — without it, legacy annotations warn
  // forever, and a warning that is always wrong is a warning nobody reads.
  const listDeclared = listDeclaredNumbers(memoryText);
  const orphanAnnotations = annotations.filter((a) => !declared.has(a.n) && !retired.has(a.n) && !listDeclared.has(a.n));

  const allDupes = [...declared.entries()].filter(([, hs]) => hs.length > 1);
  // Exact-count exemption: a grandfathered L# that grows a THIRD declaration still fails.
  const duplicates = allDupes.filter(([n, hs]) => grandfathered.get(n) !== hs.length);
  const exempt = allDupes.filter(([n, hs]) => grandfathered.get(n) === hs.length);
  const gapReuse = [...declared.keys()].filter((n) => retired.has(n)).sort((a, b) => a - b);
  const nums = [...declared.keys()];
  const maxL = nums.length ? Math.max(...nums, ...retired) : 0;

  // `maxL` stays the LEDGER's max — an honest property of this corpus, unchanged by the floor.
  // `nextFree` additionally clears every number in use elsewhere (see RULES-CORPUS IN-USE FLOOR).
  // Monotonic by construction: `inUse` can only RAISE it, so no arrangement of rules files can
  // hand back a number the ledger already holds.
  const floor = Math.max(maxL, ...(inUse.length ? inUse : [0]));
  return { declared, duplicates, grandfathered: exempt, gapReuse, ambiguous, annotations, orphanAnnotations, maxL, nextFree: floor + 1, inUseFloor: floor, retired };
}

// ── TABLE-ROW NAMESPACE: I# (ideas register) ──────────────────────────────
// ADDED 2026-07-15: the `I#` product-idea namespace in IDEAS.md
// has the SAME no-allocation-protocol defect as `L#` (maxI is a READ, not a reservation — the same
// lesson as L#, one namespace over). But its shape is SIMPLER: each entry is a table row `| I12 | … |`, and a row
// IS a declaration — there is no annotation/declaration ambiguity to resolve. So a plain count-per-number
// over `^| <letter><digits> |` rows suffices; the L# 3-way heading taxonomy does not apply. The table
// header (`| I# | …`) and separator (`|---|`) rows do NOT match `<letter>\d+` → correctly ignored.
const tableRowRe = (letter) => new RegExp(`^\\|\\s*${letter}(\\d+)\\s*\\|`);
export function scanTableNamespace(text, letter, grandfathered = new Map()) {
  const declared = new Map();
  const re = tableRowRe(letter);
  for (const l of text.split("\n")) {
    const m = re.exec(l);
    if (!m) continue;
    const n = Number(m[1]);
    if (!declared.has(n)) declared.set(n, []);
    declared.get(n).push(l);
  }
  const allDupes = [...declared.entries()].filter(([, rows]) => rows.length > 1);
  // Exact-count exemption (same discipline as the L# guard): a grandfathered collision that grows one
  // more row still FAILS.
  const duplicates = allDupes.filter(([n, rows]) => grandfathered.get(n) !== rows.length);
  const exempt = allDupes.filter(([n, rows]) => grandfathered.get(n) === rows.length);

  // FOLD 1 (2026-07-15): an UNANCHORED second pass catches a `| <letter><n> |` declaration
  // hidden MID-LINE by a malformed concatenation — two rows glued without a newline.
  // The anchored pass silently UNDER-counts those, and a detector that DROPS a declaration fails
  // OPEN — the one property this guard exists to prevent (its own header's doctrine). Surfaced as `hidden`
  // and WARNed, never blocked: a block would wedge every push on the pre-existing malformed line (the
  // amendment-FP shape). The data fix is to split the row so each number starts its own line.
  const anywhere = new Set();
  const gre = new RegExp(`\\|\\s*${letter}(\\d+)\\s*\\|`, "g");
  for (const l of text.split("\n")) { let m; while ((m = gre.exec(l))) anywhere.add(Number(m[1])); }
  const hidden = [...anywhere].filter((n) => !declared.has(n)).sort((a, b) => a - b);

  // FOLD 2 (2026-07-15): a grandfather entry whose collision no longer exists at count `c`
  // (the dup was renumbered away without dropping the entry) would silently exempt a FUTURE real collision.
  // Assert the entry still matches reality — a STALE entry is a push-boundary RED (structural, not the
  // comment v1 shipped with). Excludes numbers already flagged as duplicates (a GROWN collision is a dup,
  // handled there); fires only on a genuinely stale (shrunk/vanished) entry, so it can NEVER false-block.
  const dupeNums = new Set(duplicates.map(([n]) => n));
  const staleGrandfather = [...grandfathered.entries()]
    .filter(([n, c]) => (declared.get(n)?.length ?? 0) !== c && !dupeNums.has(n))
    .map(([n, c]) => ({ n, expected: c, actual: declared.get(n)?.length ?? 0 }));

  const nums = [...declared.keys()];
  const maxN = nums.length ? Math.max(...nums) : 0;
  return { declared, duplicates, grandfathered: exempt, hidden, staleGrandfather, maxN, nextFree: maxN + 1 };
}

// GRANDFATHERED baselines — collisions PRE-DATING this guard, exempt at their EXACT current counts
// (MEASURED by a union-grep of the live file). A grandfathered number that gains one more row
// STILL FAILS; every NEW collision from here BLOCKS. Remedy for a block = the same as L#: the LATER
// file position cedes to maxN+1. To repair a grandfathered collision (renumber the dup away), DROP its
// entry here in the SAME commit — else the guard exempts a count that no longer exists (a silent hole).
const I_GRANDFATHERED = new Map();   // IDEAS.md is collision-free today — keep it that way.
const IDEAS_DEFAULT = resolvePath(REPO_ROOT, "IDEAS.md");

// ── SELF-TEST ──
// DISCIPLINE (2026-07-10 — the review that found this guard failing open):
// *"A self-test written by the regex's author exercises the forms the regex was designed for. It
// proves the code does what it does; it cannot prove the domain is covered."* v1 printed ALL PASS
// across 11 assertions while three real bypasses shipped. So: **a guard's self-test must contain at
// least one assertion the guard currently FAILS, written before the fix.** The four ADVERSARIAL rows
// below were authored RED against v1 (each shipped a duplicate at rc=0) and are the reason v2 exists.
if (IS_MAIN && process.argv.includes("--self-test")) {
  let ok = true;
  const t = (name, cond) => { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

  const clean = ["## 2026-07-10 — L714: a", "## L272 (b)", "## 2026-07-10 — L715: c", "## L100 — d"].join("\n");
  let r = scan(clean);
  t("clean ledger → no duplicates", r.duplicates.length === 0);
  t("clean ledger → maxL 715, next free 716", r.maxL === 715 && r.nextFree === 716);

  // ── RULES-CORPUS IN-USE FLOOR — the DISCRIMINATING pair ─────────────────────
  // The live corpora are ALIGNED (invisible set {1210,1211}, both under the ledger floor), so a
  // probe against them reads 1221 whether the floor works or not — the two hypotheses AGREE and the
  // reading is worth nothing. These arms construct the misalignment reality does not currently
  // supply. State the two predicted numbers BEFORE running: broken ⇒ 716, working ⇒ 901. They
  // differ, so a PASS here means something. (Instrument standard, /meta self-audit Check 13(b).)
  t("floor: rules-homed L900 outranks a ledger at 715 → next free 901",
    scan(clean, "", GRANDFATHERED, [900]).nextFree === 901);
  t("floor: RED control — same ledger, no in-use set → next free 716 (proves the arm can read low)",
    scan(clean, "", GRANDFATHERED, []).nextFree === 716);
  t("floor: a LOWER in-use number cannot drag the floor down (monotonic)",
    scan(clean, "", GRANDFATHERED, [3, 12]).nextFree === 716);
  t("floor: maxL reports the LEDGER, never the floor — they are different questions",
    scan(clean, "", GRANDFATHERED, [900]).maxL === 715);
  t("floor: raising it creates NO duplicate and NO gap-reuse finding",
    scan(clean, "", GRANDFATHERED, [900, 714, 715]).duplicates.length === 0
    && scan(clean, "", GRANDFATHERED, [900, 714, 715]).gapReuse.length === 0);
  // The extractor itself, against a corpus whose answer is known independently of this file.
  {
    const d = mkdtempSync(resolvePath(tmpdir(), "lnum-rules-"));
    writeFileSync(resolvePath(d, "a.md"), "cites L1207 and L88 and a bare L9\n");
    writeFileSync(resolvePath(d, "b.md"), "## Heading with L1209\nprose L1207 again\n");
    writeFileSync(resolvePath(d, "ignore.txt"), "L4242 must NOT be read — .md only\n");
    const got = rulesCorpusNumbers(d).sort((a, b) => a - b);
    t("floor: extractor unions across .md files, dedupes, ignores non-.md",
      JSON.stringify(got) === JSON.stringify([9, 88, 1207, 1209]));
    t("floor: missing dir returns [] rather than throwing (fails toward no-contribution)",
      Array.isArray(rulesCorpusNumbers(resolvePath(d, "nope"))) && rulesCorpusNumbers(resolvePath(d, "nope")).length === 0);
    rmSync(d, { recursive: true, force: true });
  }
  t("all 4 declaration forms recognized (colon/paren/dash/date)", r.declared.size === 4);

  r = scan(clean + "\n## 2026-07-10 — L714: duplicate!");
  t("DUPLICATE detected", r.duplicates.length === 1 && r.duplicates[0][0] === 714);

  r = scan("## 2026-07-10 — L500: live", "## L500 — retired 2026-01-01 — dead");
  t("GAP-REUSE detected (declared + retired)", r.gapReuse.length === 1 && r.gapReuse[0] === 500);

  // ── The four ADVERSARIAL rows. Every one of these shipped a duplicate at rc=0 under v1. ──
  const base = "## 2026-07-10 — L716: the real lesson";
  const bypasses = [
    ["no colon (letter follows the number)", "## 2026-07-10 — L716 duplicate, no colon"],
    ["ASCII-hyphen date separator",          "## 2026-07-10 - L716: duplicate"],
    ["en-dash date separator (macOS subs)",  "## 2026-07-10 – L716: duplicate"],
    ["markdown emphasis around the number",  "## 2026-07-10 — **L716**: duplicate"],
  ];
  for (const [label, hdr] of bypasses) {
    const rr = scan(`${base}\n${hdr}`);
    t(`BYPASS BLOCKED — ${label}`, rr.duplicates.length === 1 && rr.duplicates[0][0] === 716);
  }

  // ── Regression rows: the OBVIOUS fix (non-annotation ⇒ declaration) manufactures these. ──
  r = scan("## 2026-06-16 — L465: real\n## 2026-06-16 — L465 + L464 RECURRENCE (same session): note");
  t("multi-L# annotation `L465 + L464 RECURRENCE` is NOT a false duplicate", r.duplicates.length === 0);
  r = scan("## 2026-06-21 — L525: real\n## 2026-06-22 — L525/L526 recurred POST-codification");
  t("multi-L# annotation `L525/L526 recurred` is NOT a false duplicate", r.duplicates.length === 0);

  const annotations = [
    "## 2026-04-21 — L200 corollary: authoritative signals",
    "## 2026-04-22 — L89 recurrence + enforcement-gap evidence",
    "## 2026-05-24 — L306 EXTENSION: sweep-via-commit",
    "## Panel Playbook — /expert-audit (L151-override)",
  ].join("\n");
  r = scan("## 2026-07-10 — L200: real\n## L89 — real\n## L306 — real\n" + annotations);
  t("annotations are NOT declarations (no false-positive duplicate)", r.duplicates.length === 0);
  t("annotations do not inflate the ledger", r.declared.size === 3);

  // `L### AMENDMENT: …` is an annotation (surfaced RED by a later check 2026-07-15). Mutation-
  // valid: WITHOUT `amendment` in the vocabulary, the colon-less tail is ambiguous → claims the number → a
  // false duplicate → this asserts 0 → REDs. It is the reason `amendment\\w*` was added to ANNOTATION_RE.
  r = scan("## 2026-06-08 — L395: real\n## 2026-07-13 — L395 AMENDMENT (the inbound half): note");
  t("`L### AMENDMENT` is an annotation, not a false duplicate", r.duplicates.length === 0);

  // AMBIGUOUS: claims its number (fails CLOSED) *and* is printed. v1 dropped this silently.
  r = scan("## 2026-07-10 — L999?? weird");
  t("ambiguous form is SURFACED, not swallowed", r.ambiguous.length === 1);
  t("ambiguous form CLAIMS its number (fails closed)", r.declared.has(999));

  // The vocabulary heuristic's one residual, closed by the orphan check.
  r = scan("## 2026-07-10 — L200: real\n## 2026-07-10 — L801 recurrence is not evidence");
  t("orphan annotation (L# declared nowhere) is surfaced", r.orphanAnnotations.length === 1 && r.orphanAnnotations[0].n === 801);

  // grandfathered baseline: exempt at its exact count, FAILS if it grows
  const GF = new Map([[900, 2]]);   // synthetic — the real baseline is empty
  r = scan("## L900 — a\n## 2026-06-23 — L900: b", "", GF);
  t("grandfathered x2 → not a blocking duplicate", r.duplicates.length === 0 && r.grandfathered.length === 1);
  r = scan("## L900 — a\n## 2026-06-23 — L900: b\n## 2026-07-10 — L900: c", "", GF);
  t("grandfathered x3 → BLOCKS (exemption is exact-count)", r.duplicates.length === 1);
  t("real baseline has NO exemptions", GRANDFATHERED.size === 0);
  r = scan("## 2026-07-10 — L714: a\n## 2026-07-10 — L714: b");
  t("a NEW duplicate is never grandfathered", r.duplicates.length === 1 && r.duplicates[0][0] === 714);

  // ── TABLE-NAMESPACE (H#/I#) — added 2026-07-15 ──
  const table = ["| H1 | a |", "| H2 | b |", "| H3 | c |"].join("\n");
  let h = scanTableNamespace(table, "H");
  t("table-ns: clean table → no duplicates", h.duplicates.length === 0);
  t("table-ns: maxN 3, next free 4", h.maxN === 3 && h.nextFree === 4);
  // THE load-bearing mutation-valid row — a fresh collision MUST block (reds if the guard misses it).
  h = scanTableNamespace(table + "\n| H2 | b-dup |", "H");
  t("table-ns: a NEW H# duplicate BLOCKS", h.duplicates.length === 1 && h.duplicates[0][0] === 2);
  // header (`| H# |`) + separator (`|---|`) rows are NOT declarations — the real H1 dup still blocks.
  h = scanTableNamespace("| H# | title |\n|---|---|\n| H1 | a |\n| H1 | b |", "H");
  t("table-ns: header/separator ignored; real H1 dup still BLOCKS", h.duplicates.length === 1 && h.duplicates[0][0] === 1);
  // grandfathered exact-count exemption.
  const HGF = new Map([[46, 3]]);
  h = scanTableNamespace("| H46 | a |\n| H46 | b |\n| H46 | c |", "H", HGF);
  t("table-ns: grandfathered H46×3 → not a blocking duplicate", h.duplicates.length === 0 && h.grandfathered.length === 1);
  h = scanTableNamespace("| H46 | a |\n| H46 | b |\n| H46 | c |\n| H46 | d |", "H", HGF);
  t("table-ns: grandfathered H46 gaining a 4th row → BLOCKS (exact-count)", h.duplicates.length === 1);
  // the I# namespace runs the SAME checker — a dup must block there too.
  const i = scanTableNamespace("| I1 | x |\n| I2 | y |\n| I1 | dup |", "I");
  t("table-ns: I# duplicate BLOCKS (same checker)", i.duplicates.length === 1 && i.duplicates[0][0] === 1);
  // a row whose number is embedded mid-title (not in leading `| H\\d |` position) does NOT false-match.
  h = scanTableNamespace("| H1 | completes H92 and H138 |", "H");
  t("table-ns: an H# referenced mid-title is NOT counted as a declaration", !h.declared.has(92) && h.declared.has(1));
  t("table-ns: a mid-TITLE ref is NOT `hidden` either (no surrounding pipes)", h.hidden.length === 0);

  // FOLD 1 — a declaration hidden MID-LINE by a `||` concatenation
  // is SURFACED in `hidden`, while a well-formed line-start row is not.
  h = scanTableNamespace("| H1 | a |\n| H2 | b | glued tail || H99 | hidden decl |", "H");
  t("table-ns: a mid-line hidden H# (malformed concat) is surfaced in `hidden`", h.hidden.length === 1 && h.hidden[0] === 99);
  t("table-ns: a well-formed line-start H# is NOT in `hidden`", !h.hidden.includes(1) && !h.hidden.includes(2));

  // FOLD 2 — a STALE grandfather entry (the collision was renumbered away) is a RED. Mutation-valid:
  // without the assertion, stale [900,2] + live H900×1 exempts a future collision silently.
  const staleGF = new Map([[900, 2]]);
  h = scanTableNamespace("| H900 | only one now |", "H", staleGF);
  t("table-ns: STALE grandfather ([900,2] but live ×1) is flagged", h.staleGrandfather.length === 1 && h.staleGrandfather[0].n === 900);
  h = scanTableNamespace("| H900 | a |\n| H900 | b |", "H", staleGF);
  t("table-ns: an ACCURATE grandfather ([900,2] live ×2) is NOT stale", h.staleGrandfather.length === 0);

  // ── TIER-UNION rows (2026-08-06, PHASE 1 of the meta memory archive split) ──────────────────
  // AUTHORED RED, per this block's own discipline. Measured against the pre-union code on the
  // very fixture pair below (`scan(readFileSync(MEMORY.md))`, i.e. what MEMORY_DEFAULT did):
  //     (a) SINGLE-FILE: declarations=1  duplicates=0   ← the cross-tier duplicate SHIPS
  //     (b) UNION      : declarations=1  duplicates=1   ← caught
  // The `control` row after each adversarial row is what makes the pair DISCRIMINATING rather
  // than merely green: it asserts the single-file read still MISSES, so a future revert to a
  // one-file default cannot leave these rows passing. Real files on disk, not strings — the unit
  // under test is the directory scan + concatenation, which a string fixture cannot reach.
  const mkTier = (files) => {
    const d = mkdtempSync(joinPath(tmpdir(), "lesson-tier-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(joinPath(d, name), body);
    return d;
  };

  // ROW 1 — the same L# declared once in an archive shard and once in the hot router.
  const tierA = mkTier({
    "MEMORY.md": "## 2026-08-06 — L1200: hot-tier copy\n",
    // The second archived number exists ONLY in the archive — it is what makes the GAP-REUSE row
    // below discriminating. (First cut retired the shared number, which lives in BOTH tiers, so the
    // row passed off the hot copy and stayed green under the narrowing mutation: a decorative
    // assertion, caught by running it.)
    "MEMORY-ARCHIVE-2026-04-01-2026-05-01.md": "## 2026-04-02 — L1200: archived copy\n## 2026-04-03 — L1201: archive-only lesson\n",
  });
  const pathsA = memoryTierPaths(tierA);
  t("union: BOTH tiers are discovered (router + archive shard)", pathsA.length === 2);
  // Filename order IS append order: `-` (0x2D) < `.` (0x2E), so shards precede the router.
  t("union: archive shard sorts BEFORE the hot router (append order preserved)",
    /MEMORY-ARCHIVE/.test(pathsA[0]) && /MEMORY\.md$/.test(pathsA[1]));
  let u = scan(readMemoryTiers(pathsA));
  t("ADVERSARIAL — duplicate L# SPLIT ACROSS archive+router BLOCKS", u.duplicates.length === 1 && u.duplicates[0][0] === 1200);
  let ctl = scan(readFileSync(joinPath(tierA, "MEMORY.md"), "utf8"));
  t("control — the single-file read MISSES it (why the union is load-bearing)", ctl.duplicates.length === 0);

  // ROW 2 — GAP-REUSE across tiers, keyed on the ARCHIVE-ONLY number so the hot tier cannot
  // satisfy it: narrow the glob and this goes RED rather than passing off the router's copy.
  u = scan(readMemoryTiers(pathsA), "## L1201 — retired 2026-01-01 — dead");
  t("union: GAP-REUSE is detected against an ARCHIVE-ONLY declaration", u.gapReuse.length === 1 && u.gapReuse[0] === 1201);
  ctl = scan(readFileSync(joinPath(tierA, "MEMORY.md"), "utf8"), "## L1201 — retired 2026-01-01 — dead");
  t("control — the single-file read MISSES the archive-only gap-reuse", ctl.gapReuse.length === 0);
  rmSync(tierA, { recursive: true, force: true });

  // ROW 3 — the legacy LIST-form era is the single largest block and is archive-bound.
  // It feeds ONLY orphan-suppression (LIST_DECL_RE). If it falls outside the union, every hot-tier
  // annotation on a legacy lesson warns forever.
  const tierB = mkTier({
    "MEMORY.md": "## 2026-08-06 — L1300: real\n## 2026-08-06 — L89 recurrence: note on a legacy lesson\n",
    "MEMORY-ARCHIVE-legacy-list-L001-L222.md": "89. **Memory possession ≠ application**\n",
  });
  u = scan(readMemoryTiers(memoryTierPaths(tierB)));
  t("union: legacy LIST-form decl in the ARCHIVE suppresses a hot-tier orphan annotation", u.orphanAnnotations.length === 0);
  ctl = scan(readFileSync(joinPath(tierB, "MEMORY.md"), "utf8"));
  t("control — without the archive that annotation reads as an ORPHAN (listDeclared must span tiers)",
    ctl.orphanAnnotations.length === 1 && ctl.orphanAnnotations[0].n === 89);
  rmSync(tierB, { recursive: true, force: true });

  // ROW 4 — the family glob must admit the WHOLE coming shape (router + dated shards + the legacy
  // shard) and admit NOTHING else in that directory. A glob that also swallowed RULES.md/CHANGELOG.md
  // would pull ~1.35 MB of L#-CITING prose into the scan, where `## L###` citations in headings would
  // read as declarations and manufacture false duplicates — the cry-wolf failure this file's header
  // says gets `SKIP_LESSON_NUMBER_CHECK=1` set permanently.
  const tierC = mkTier({
    "MEMORY.md": "## 2026-08-06 — L1400: router\n",
    "MEMORY-ARCHIVE-2026-04-14-2026-05-23.md": "## 2026-04-15 — L1401: shard one\n",
    "MEMORY-ARCHIVE-legacy-list-L001-L222.md": "## 2026-04-01 — L1402: legacy shard\n",
    "RULES.md": "## L1400: a CITATION, not a declaration\n",
    "CHANGELOG.md": "## L1401: another citation\n",
    "WATCH-TIER.md": "## L1402: live register, not the L# ledger\n",
    "RETIRED.md": "## L999 — retired 2020-01-01 — dead\n",
  });
  const pathsC = memoryTierPaths(tierC);
  t("union: glob admits router + dated shard + legacy shard = exactly 3", pathsC.length === 3);
  t("union: glob EXCLUDES RULES/CHANGELOG/WATCH-TIER/RETIRED (they cite L#, they do not declare it)",
    !pathsC.some((p) => /RULES|CHANGELOG|WATCH-TIER|RETIRED/.test(p)));
  u = scan(readMemoryTiers(pathsC));
  t("union: the 3 tiers yield 3 declarations and NO false duplicate from sibling citers", u.declared.size === 3 && u.duplicates.length === 0);
  rmSync(tierC, { recursive: true, force: true });

  // ROW 5 — an unreadable/absent directory yields an EMPTY set, which the main block turns into a
  // fail-CLOSED exit. Pins that `memoryTierPaths` reports emptiness rather than throwing (a throw
  // would abort the gate with a stack trace instead of the verdict).
  t("union: a nonexistent dir returns [] (caller fails closed, no throw)",
    memoryTierPaths(joinPath(tmpdir(), "definitely-not-a-meta-dir-4f2a")).length === 0);

  console.log(ok ? "\nself-test: ALL PASS" : "\nself-test: FAILURES");
  process.exit(ok ? 0 : 1);
}

if (IS_MAIN) {
  // CLI BACK-COMPAT is load-bearing, not politeness: `.githooks/pre-push` invokes bare (→ union),
  // while the smoke suite and the `git show HEAD:<path> >` HEAD-plane check pass ONE explicit path
  // and must keep scanning exactly that file. An explicit arg therefore pins a single-file scan.
  const explicitPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const memPaths = explicitPath ? [explicitPath] : memoryTierPaths();
  const retPath = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : RETIRED_DEFAULT;

  // FAIL CLOSED. This used to `exit(0)` — "nothing to check" read as a PASS to every
  // composing gate, so a moved file, a drifted constant, an empty `git show >` redirect, or a
  // typo'd path all produced a green push. A gate that cannot read its target has not checked
  // it; only `✓ lesson-numbers clean — N declarations` proves a ledger was read.
  // The union adds one more way to read nothing — an EMPTY match set (wrong dir, renamed family) —
  // and it must fail the same way, not sail through as "no files, no duplicates".
  const missing = memPaths.filter((p) => !existsSync(p));
  if (!memPaths.length || missing.length) {
    const what = memPaths.length ? missing.join(", ") : `${META_DIR}/MEMORY*.md (no tier file matched)`;
    console.error(`✗ lesson-numbers: ${what} not found — the ledger was NOT checked (failing closed, not passing)`);
    process.exit(1);
  }
  const r = scan(readMemoryTiers(memPaths), existsSync(retPath) ? readFileSync(retPath, "utf8") : "", GRANDFATHERED, rulesCorpusNumbers());

  // ⚠ FOURTH FAIL-OPEN OF THE SAME FAMILY (2026-07-31) — `existsSync` guards MISSING, not EMPTY.
  // The comment above states the invariant ("only `✓ … — N declarations` proves a ledger was read")
  // and the code did not enforce it: N could be 0. Measured — an empty file printed
  // `✓ lesson-numbers clean — 0 declarations, maxL 0, next free L1` at rc=0. That is worse than a
  // silent pass: the summary line is where a minting seat READS its next number (one
  // collision was caused by misreading this very line), so an unread ledger does not merely fail to
  // detect a duplicate — it EMITS A MINT INSTRUCTION ("next free L1") that manufactures one.
  // Reachable BY CONSTRUCTION, not hypothetically: the canonical way to check the PUSHED ledger is
  // `git show HEAD:<path> > f`, and on any failure that leaves an EXISTING, EMPTY f (measured:
  // git-show rc=128, 0 bytes) — i.e. the fix for the worktree-vs-HEAD plane mismatch ARMS this
  // unless the zero-declaration read fails closed first. Mutation-proven: deleting these 4 lines
  // returns the empty-file case to rc=0 while the real ledger stays rc=0 (662 declarations).
  if (r.declared.size === 0) {
    console.error(`✗ lesson-numbers: ${memPaths.join(", ")} yielded 0 declarations — the ledger was NOT read (failing closed, not passing)`);
    process.exit(1);
  }

  // WARNING COUNT CARRIED INTO THE VERDICT LINE (2026-07-31, three-seat measurement).
  // This gate printed a real orphan-annotation warning on EVERY run for two weeks and no seat
  // ever read it. Measured cause across three sessions — none of them inattention:
  //     `| tail -1`                                    (contiguous slice: warnings never printed)
  //     `| grep -E '^✓|^✗'`                            (verdict selected wherever it sits)
  //     `| grep -iE 'duplicate|maxL|clean|✓|✗' | head` (whitelist omitting the ⚠ glyph)
  // Moving the warnings BELOW the verdict fixes only the first. Callers select by CONTENT as
  // often as by position, so a gate cannot make diagnostics readable by MOVING them — only by
  // making the line every caller already selects for CARRY the fact that diagnostics exist.
  let warnCount = 0;

  if (r.ambiguous.length) {
    warnCount++;
    console.log(`⚠ lesson-numbers: ${r.ambiguous.length} heading(s) with an L# in declaration position but an unrecognized form:`);
    for (const h of r.ambiguous.slice(0, 5)) console.log(`    ${h.slice(0, 100)}`);
    console.log("    (treated AS declarations — fail-closed — so a duplicate hiding here still blocks)");
  }

  if (r.orphanAnnotations.length) {
    warnCount++;
    console.log(`⚠ lesson-numbers: ${r.orphanAnnotations.length} annotation(s) referencing an L# that is declared NOWHERE:`);
    for (const a of r.orphanAnnotations.slice(0, 5)) console.log(`    L${a.n}  ${a.h.slice(0, 92)}`);
    console.log("    (a typo, or a colon-less DECLARATION misread as an annotation — check before ignoring)");
  }

  if (r.grandfathered.length) {
    warnCount++;
    console.log(`⚠ lesson-numbers: ${r.grandfathered.length} GRANDFATHERED duplicate(s) predating this guard:`);
    for (const [n, hs] of r.grandfathered) console.log(`    L${n} × ${hs.length} (exempt at exactly this count; a third declaration FAILS)`);
  }

  let bad = false;
  if (r.duplicates.length) {
    bad = true;
    console.log(`✗ lesson-numbers: DUPLICATE L# — the ledger accepted the same number twice`);
    for (const [n, hs] of r.duplicates) {
      console.log(`    L${n} × ${hs.length}:`);
      for (const h of hs) console.log(`      ${h.slice(0, 110)}`);
    }
    console.log(`  Fix: renumber ONLY YOUR OWN entry (never a peer's — citations in flight).`);
    console.log(`       The LATER FILE POSITION cedes. Move to L${r.nextFree} — above maxL, never into a gap.`);
    console.log(`       Then sweep every citation: grep -rn '\\bL<old>\\b' .claude/`);
  }
  if (r.gapReuse.length) {
    bad = true;
    console.log(`✗ lesson-numbers: GAP-REUSE — L${r.gapReuse.join(", L")} is declared in MEMORY.md and retired in RETIRED.md.`);
    console.log(`  Retired numbers are never reassigned (monotonic-ID ⇒ monotonic-time). Use L${r.nextFree}.`);
  }

  // ── I# (ideas register) table namespace — added 2026-07-15 ──
  const tableChecks = [
    { letter: "I", path: IDEAS_DEFAULT, gf: I_GRANDFATHERED, name: "ideas I#" },
  ];
  const tableSummary = [];
  for (const tc of tableChecks) {
    if (!existsSync(tc.path)) continue;
    const tr = scanTableNamespace(readFileSync(tc.path, "utf8"), tc.letter, tc.gf);
    // Label the aggregation explicitly: a bare max beside "next free L<N>" reads as
    // next-free — it is maxN, a READ, not a reservation.
    tableSummary.push(`max ${tc.letter}${tr.maxN} → next ${tc.letter}${tr.maxN + 1}`);
    if (tr.grandfathered.length) {
      warnCount++;
      console.log(`⚠ ${tc.name}: ${tr.grandfathered.length} GRANDFATHERED collision(s) predating this guard (exempt at exact count; +1 row FAILS):`);
      for (const [n, rows] of tr.grandfathered) console.log(`    ${tc.letter}${n} × ${rows.length}`);
    }
    if (tr.hidden.length) {
      warnCount++;
      console.log(`⚠ ${tc.name}: ${tr.hidden.length} ${tc.letter}# occurrence(s) NOT at line-start — hidden by a malformed/concatenated row, so the anchored scan under-counts them and a FUTURE line-start reuse would ship a real duplicate:`);
      console.log(`    ${tr.hidden.map((n) => tc.letter + n).join(", ")}`);
      console.log(`    (fix the DATA: split the concatenated row so each ${tc.letter}# begins its own line — grep '|| ${tc.letter}' in ${tc.path})`);
    }
    if (tr.staleGrandfather.length) {
      bad = true;
      console.log(`✗ ${tc.name}: STALE grandfather entry — a collision no longer exists at its exempted count (renumbered away without dropping the entry) → it would silently exempt a FUTURE real collision:`);
      for (const s of tr.staleGrandfather) console.log(`    ${tc.letter}${s.n}: exempted at ×${s.expected}, live count ×${s.actual} — drop ${tc.letter}${s.n} from ${tc.letter}_GRANDFATHERED in scripts/check-lesson-numbers.mjs`);
    }
    if (tr.duplicates.length) {
      bad = true;
      console.log(`✗ ${tc.name}: DUPLICATE ${tc.letter}# in ${tc.path} — the namespace accepted the same number twice (the L# defect, one namespace over)`);
      for (const [n, rows] of tr.duplicates) {
        console.log(`    ${tc.letter}${n} × ${rows.length}:`);
        for (const row of rows) console.log(`      ${row.slice(0, 110)}`);
      }
      console.log(`  Fix: renumber ONLY YOUR OWN row (never a peer's — the LATER file position cedes). Move to ${tc.letter}${tr.nextFree} — above maxN, never into a gap.`);
    }
  }

  if (bad) {
    console.log(`  SKIP_LESSON_NUMBER_CHECK=1 bypasses (owner approval only — it guards the citation ledgers).`);
    process.exit(1);
  }
  // ⛔ THE VERDICT TOKEN ITSELF MUST CARRY THE WARNINGS (2026-08-01).
  // The block above got the diagnosis right and stopped one step short: it appended the warning
  // COUNT to a line whose leading token still read `✓ lesson-numbers clean`. A caller — human or
  // grep — that selects the verdict still reads CLEAN while the tool is simultaneously saying
  // something is wrong, and the trailing "they are not decoration" is a PLEA, not a mechanism.
  // Measured damage surface: peers paste this token into fleet mail as a portable "all good"
  // receipt, some copies without the warning suffix at all. So the token flips: `✓ … clean` is
  // emitted ONLY at warnCount 0.
  // rc stays 0 — these are warnings, not failures, and .githooks/pre-push branches on the EXIT
  // CODE (`if ! node …`), never on this string, so retoning breaks no gate.
  const verdict = warnCount
    ? `⚠ lesson-numbers: PASS WITH ${warnCount} WARNING(S) — not clean`
    : `✓ lesson-numbers clean`;
  // TIER COUNT ON THE VERDICT LINE (2026-08-06). The union's failure mode is reading FEWER tiers
  // than exist — a renamed shard, a moved dir — and that under-read is invisible in every other
  // number on this line (declarations drop, but nobody knows what the count "should" be). Naming
  // the tier count makes a silent under-read legible to the one line every caller already selects
  // for. Emitted only at >1 so today's single-file output is byte-identical to the pre-split form.
  const tierNote = memPaths.length > 1 ? ` · ${memPaths.length} tiers unioned` : "";
  // LABEL THE DIVERGENCE, never let it read as an off-by-N. `next free` now clears the
  // rules-corpus floor too, so it can sit ABOVE maxL+1 — legitimately. Silent, that looks like the
  // arithmetic bug a reader's first instinct suspects; named, it is a fact about where lessons live.
  const floorNote = r.inUseFloor > r.maxL ? ` (floor L${r.inUseFloor} — a rules-homed lesson outranks the ledger)` : "";
  console.log(`${verdict} — ${r.declared.size} declarations, maxL ${r.maxL}, next free L${r.nextFree}${floorNote}${tierNote}`
    + (tableSummary.length ? ` · ${tableSummary.join(" · ")}` : "")
    + (warnCount ? ` · ⚠ ${warnCount} warning(s) ABOVE — scroll up, they are not decoration` : ""));
}
