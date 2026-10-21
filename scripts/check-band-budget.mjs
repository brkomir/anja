#!/usr/bin/env node
// check-band-budget.mjs — the always-loaded instruction-band BYTE budget (meta-audit, 2026-07-11).
//
// WHY: the always-loaded band (CLAUDE.md + AGENTS.md + every .claude/rules/*.md) is injected into EVERY
// turn's context, and re-delivered as the RULES-portion of every sub-agent dispatch (the dispatch-ONLY
// additions -- _agent-primer.md ~11.5 KB + each agent's SKILL/MEMORY -- are a separate UNMEASURED cost
// this gate does NOT cover). It compounded ~2.5x/month (rules dir 5->25->89->221 KB
// across 90 days) because every governor counted LINES/ROWS while the real cost unit is BYTES/TOKENS — so
// each surface "held" its line-cap by growing DENSITY, and a bound cap got RAISED (Hot Tier 40->48->60,
// distill 1500->4000). The ONE always-loaded file with a hard BYTE cap (the project MEMORY index, via
// check-memory-budget.sh) is the only surface that stayed FLAT. This extends that proven byte-cap to the
// whole band, turning every future always-loaded addition into a DISPLACEMENT decision.
//
// RATCHET DISCIPLINE (load-bearing): BLOCK is set just ABOVE the current band so the baseline PASSES; it
// fires only on FURTHER growth. When it binds, COMPRESS (2-band split · distill · move incident-narratives
// out of rules and into the L# body each row cites) and ratchet BLOCK *DOWN* — NEVER raise it. Raising the
// ceiling when it binds recreates the exact line-cap failure this budget exists to fix (a governor that is
// raised whenever it binds is not a governor). Codified by the meta-audit.
//
// ⚠️ DOCTRINE AMENDED ONCE — the never-raise rule above was BROKEN deliberately,
// not drifted past. Read the 2026-07-29 RATCHET LOG entry before citing "NEVER raise" as current policy.
// The rule still governs every SEAT: no session raises this ceiling on its own. It was raised as a
// deliberate decision, on a measured finding that the sanctioned remedy could no longer reach the
// target (see the log entry).
//
// Wired: .githooks/pre-push (gated on a CLAUDE.md / AGENTS.md / .claude/rules change). Block-mode: a push
// that grows the band past the ceiling is REJECTED. Escape: SKIP_BAND_BUDGET_CHECK=1.
// Self-test (instrument standard — RED-control per branch, mutation-valid): node scripts/check-band-budget.mjs --self-test

import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ratchet thresholds (bytes). Current band ~230.7 KB (2026-07-12, after the 2-band split). BLOCK just
// above → baseline passes, growth blocks. RATCHET DOWN as the band is compressed; NEVER up.
//
// RATCHET LOG (the point of this file — each entry must go DOWN):
//   2026-09-07  band 641597 B  → effective ceiling 710000 (ratchet re-baseline: observedMin 641597 + margin 68403)
//               DELIBERATE RAISE, the 4th, to 710k — decided after a dedicated compression pass measured the sanctioned
//               lever exhausted: 13,025 B of narrative displaced across eleven files and a further 11,790 B relocated
//               off the gated plane landed the band 2,167 B under the old ceiling, against fleet growth of ~20 KB per
//               4 days. Margin sized to absorb ~3 such rounds. Same adoption-pattern re-baseline as 08-26, in
//               band-ratchet.json, NOT BLOCK_BYTES.
//   2026-08-26  band 607924 B  → effective ceiling 643764 (ratchet re-baseline: observedMin 607924 + margin 35840)
//               DELIBERATE RAISE, the 3rd, to current + 35 KB margin — after a
//               pilot revert deliberately re-added 21.6 KB (delivery over bytes) and fleet growth ate the allow-on-
//               shrink margin to -1.6 KB. Sized current+~35KB per the 08-01 pattern. Implemented in band-ratchet.json
//               (adoption-pattern re-baseline), NOT by touching BLOCK_BYTES — the DOWN-ratchet resumes from here.
//               (This entry goes UP; the header's "each entry must go DOWN" binds SEATS — a deliberate, documented
//               raise decision is the one exception, per the 2026-07-29 entry's own reading.)
//   2026-07-11  band ~245 KB  → WARN 243_000 / BLOCK 250_000  (baseline, at-current)
//   2026-07-12  band ~230.7 KB → WARN 233_000 / BLOCK 236_000  (2-band split: the orchestrator-only
//               rows left .claude/rules/ for .claude/orchestrator/, hook-delivered — active-recall.md
//               55.6 → 36.0 KB. Same ~5 KB headroom the 245 KB baseline had.)
//               ⚠️ ANNOTATED 2026-08-12 — THIS IS THE LOG'S ONLY DOWN-MOVE AND IT
//               WAS NOT A COMPRESSION. The doctrine above earns a down-move by COMPRESSING; this one
//               RELOCATED. The rows left a gated, cached, once-per-session channel for an UNGATED,
//               hook-delivered, PER-TURN one: bandFiles() below covers CLAUDE.md + AGENTS.md +
//               .claude/rules/*.md ONLY, so .claude/orchestrator/active-recall-orchestrator.md has been
//               invisible to this ledger ever since. Measured 2026-08-12: 18,852 chars / 19,076 B,
//               injected 490x across 7 sessions = ~1.4 MB/session.
//               The saving is REAL on the SUB-AGENT axis (they never fire UserPromptSubmit, ~14.5 KB
//               off every dispatch — that half stands); it is ZERO on the orchestrator's own per-turn
//               axis, where the cost arguably rose. ⛔ Do NOT "fix" this by folding Band-O into
//               BLOCK_BYTES: per-turn bytes and cached-prefix bytes are different COST CURVES, and
//               summing across curves is the unit error this file was written to fix. Report it as its
//               own line with its own multiplier, or leave it out and say so.
//               ⛔ SHIPPED 2026-08-24 — annotated here per this log's own rule (when a deferred
//               candidate ships, annotate the entry that deferred it in the SAME commit). "Report it
//               as its own line" is now the behaviour, not the prescription: measure() partitions by
//               classifyBandPath(), render() prints Band-O separately and compares only the GATED
//               subtotal to the ceiling. What this paragraph did NOT say, and what cost nine days:
//               between 2026-08-15 and today Band-O was in `total` and `render()` gated `total`, so
//               the prohibition was being violated by this file's own output while its text stood.
//               A prohibition is not a control — `--self-test`'s `plane:` and `plane-render:` arms are.
//   2026-07-29  band 277.7 KB → WARN 327_000 / BLOCK 330_000  ⬆️ RAISED — the FIRST up-move in this log,
//               a deliberate decision, doctrine amended in the header above. NOT a compression result; the band did
//               not shrink. Reason: the sanctioned remedy became arithmetically unable to reach the
//               target — a measurement found ~19-20 KB total recoverable (~15 KB displaceable commentary +
//               ~4 KB compression yield at a 9.4% best-case rate) against a 41.7 KB overage, so
//               displacement could not clear the ceiling even executed perfectly. The fix was judged
//               not worth its cost at this point, a middle ground was chosen over the 512 KB option
//               that was on the table, and the governor-shape question was deferred.
//               Headroom 52.3 KB ≈ 22 days at the measured +2.3 KB/day drift — but growth is BURSTY, not
//               linear: fleet wrap-days step the band (2026-07-29 measured +66/-4 lines across 5 band
//               commits in 12h, wrap-shaped), so a heavy day can eat this in one sitting.
//               ⚠️ WHAT THIS DOES NOT FIX — the gate is still LEVEL-only and DIRECTION-BLIND (classify()
//               reads `total` alone), so while over the ceiling it rejects a push that CUTS bytes exactly
//               as it rejects one that adds. The standing candidate is DELTA-GATING (block only when
//               over AND the push INCREASES band bytes, ~10-15 LOC) — deferred with this raise, not
//               rejected.
//               ⛔ CLOSED 2026-07-31 — READ THIS BEFORE CITING THE PARAGRAPH ABOVE.
//               Delta-gating SHIPPED: see `gateDecision()` below, and its both-arms self-test cases
//               ("over ceiling + push SHRINKS -> ALLOW"). The paragraph above is preserved as the
//               historical basis for the raise, NOT as current behaviour. It was left unannotated for
//               13 days and a 2026-08-13 panel read it as live, filed "classify() reads `total` alone"
//               as a measured present-tense defect, and briefed a build to re-implement a gate that
//               was already in the file. That is the durable-staleness shape `tests-unit.md` governs
//               (sweep the DURABLE layer first): a wrong sentence in a checked-in header misleads
//               silently and indefinitely, and a RATCHET LOG is read as current state precisely
//               because it is dated. Rule for this log: when a deferred candidate SHIPS, annotate the
//               entry that deferred it in the same commit.
//   2026-08-01  band 365.0 KB → WARN 395_000 / BLOCK 400_000  ⬆️ RAISED — SECOND deliberate up-move
//               (the option chosen: raise the ceiling with a documented basis). Found 35.0 KB over the
//               330 ceiling at a push-decision moment; 31 KB of the breach predated the discovering
//               session's work. DOCUMENTED BASIS (measured, not picked): new ceiling = current measured
//               365.0 KB + headroom sized to absorb ONE wrap-scale persist burst — tonight's marathon
//               wrap measured +35 KB in one sitting (18 minted lessons + rule folds + batch executions),
//               and the prompt-ceiling sizing rule applies by symmetry: size a raise to absorb the
//               round, not just the current composition.
//               At the organic +2.3 KB/day drift the same headroom ≈ 15 days. Either way the
//               gate re-binds at the next burst-or-fortnight and forces the next deliberate review.
//               Rows-vs-bytes reconciliation gap (fold-is-row-neutral-but-byte-positive) recorded in the
//               discovering batch's report — still open.
//   2026-08-02  band 404.4 KB → WARN 435_000 / BLOCK 440_000  ⬆️ RAISED — THIRD deliberate up-move.
//               Band measured 404,447 B at
//               the decision moment — over the 400 ceiling; ~5 KB of the breach was same-day cross-session
//               rule growth (i18n.md compliance-fix block +2.7 KB, bash-environment.md SKIP_*-escape
//               section), not one session's addition. DOCUMENTED BASIS (same method as 08-01): new
//               ceiling = current measured band + ~35 KB margin (the 08-01 margin, re-applied — sized to
//               absorb a multi-week growth round, not just the current composition). Write-path
//               discipline UNCHANGED: displacement-on-add + next-touch narrative demotion remain the
//               doctrine; the ceiling is the backstop, not the control.
//   2026-08-07  band 586.3 KB → WARN 820_000 / BLOCK 825_000  ⬆️ RAISED — FIFTH deliberate up-move
//               (the judgment this time: the ceiling should sit materially higher).
//               ⛔ THE METHOD IS UNCHANGED; THE INPUT WAS WRONG FOR ALL FOUR PRIOR RAISES. Each of
//               those sized margin as "band + ~35 KB, to absorb ONE wrap-scale persist burst", and
//               cited "≈ 15 days at the organic +2.3 KB/day drift" (08-01 basis). MEASURED 2026-08-07,
//               per-file against the tree as of 08-03 23:46: .claude/rules/ went 408.8 → 543.8 KB, i.e.
//               +135.0 KB in 4 days ≈ 34 KB/day — roughly 15x the assumed drift. So a 35 KB margin
//               buys about ONE DAY, which is precisely why the ceiling moved four times in five days.
//               A raise is not a control when its margin is sized off a rate that is 15x low.
//               DOCUMENTED BASIS: current measured band 586,345 B + ~238 KB ≈ 7 days at the measured
//               4-day average. Sized to a WEEK deliberately, not to a burst — the prior "absorb one
//               wrap" framing is what produced the churn. WARN keeps the 5 KB standoff.
//               ⚠️ TWO NUMBERS THAT SHOULD TEMPER ANY COMFORT THIS BUYS:
//               (a) the band grew 581.4 → 586.3 KB DURING the measurement session, and fleet growth
//                   across that one ~26h session window was +61.4 KB (≈57 KB/day) — above the 4-day
//                   average, because a heavy codification night is the norm now, not the exception.
//                   At 57 KB/day this margin is ~4 days, not 7.
//               (b) the real lever is not the ceiling. Fleet-wide over those 4 days: +822 lines added
//                   to .claude/rules/, 58 removed — a 14:1 ADD:REMOVE ratio. The doctrine's remedy
//                   ("demote at NEXT-TOUCH, one rule at a time, by the seat already reading it") is
//                   structurally outpaced: removal happens at the rate one seat reads, codification at
//                   the rate six seats write. This raise TRACKS growth; it does not control it.
//               DISPLACEMENT TARGET THAT DOES WORK, applied this session: narrative lesson bodies go
//               to a skill-scoped lesson file (loads only when that skill runs, band cost ZERO) while the DIRECTIVE stays in
//               .claude/rules/. Four lessons landed that way for 0 bytes. Prefer it over a raise.
//   2026-08-03  band 438.0 KB → WARN 468_000 / BLOCK 473_000  ⬆️ RAISED — FOURTH deliberate up-move
//               (taken in answer to an explicit two-reading
//               fork — raise-the-ceiling vs re-rank-the-priority — resolved to the raise). Band measured
//               438,003 B at the decision moment, 2.0 KB under the 440 ceiling. DOCUMENTED BASIS
//               (identical method to 08-01 and 08-02, not re-picked): new ceiling = current measured
//               band + ~35 KB margin, sized to absorb ONE wrap-scale persist burst rather than the
//               current composition. WARN keeps the 5 KB standoff of the last two rounds.
//               ⚠️ HONEST DELTA FROM THE PRIOR THREE: this raise was NOT taken at a breach. 08-01 and
//               08-02 were both decided while OVER the ceiling at a push moment; here the gate was
//               already CLEAR — this session hit 441.0 KB (BLOCK), and the discovering seat relieved
//               it to 438.0 by demoting its OWN two incident narratives into the L# bodies they cite
//               (−47 lines, every directive kept verbatim). So the measured 438.0 already
//               reflects one displacement pass; the raise buys margin on top of a cleaned number
//               rather than papering over an unpaid one.
//               ⚠️ FOURTH RAISE IN SIX DAYS (07-29 → 08-01 → 08-02 → 08-03), and the header above says
//               a limit that moves this often is not a control. Recording that here rather than in a
//               summary nobody re-reads: the ceiling is the BACKSTOP, and the control is the write path
//               — displacement-on-add + next-touch narrative demotion, UNCHANGED by this.
//               The open governor-shape question (rows-vs-bytes) and the DELTA-GATING
//               candidate (block only when over AND the push INCREASES bytes) both remain deferred, not
//               rejected.
//               ⛔ THE DELTA-GATING HALF OF THAT SENTENCE WAS FALSE WHEN WRITTEN (annotated 2026-08-13).
//               Delta-gating shipped 2026-07-31; this entry was authored 2026-08-03,
//               three days later, and restated the 07-29 entry's deferral list without
//               re-deriving it. Only the rows-vs-bytes question was still open. Restating settled state
//               does not feel like asserting, which is exactly why it goes unchecked — and here TWO
//               entries carried the same dead claim until a panel acted on it.
// ⛔ READ THIS BEFORE CITING BLOCK_BYTES AS "THE CEILING" — it has not been the binding one since
// 2026-08-13 (annotated 2026-08-17, measured). The ratchet below wraps both
// constants in `min()`, so the LIVE ceiling is `observedMin + marginBytes` whenever that is lower:
// 641,597 + 68,403 = 710,000 B as of 2026-09-07 (the 4th re-baseline), 115,000 B under this number. BLOCK_BYTES went inert at the
// FIRST ratchet down-move (721,152 + 84,563 = 805,715 < 825,000) and last changed 2026-08-08
// — nine days with no raise, because nothing has needed one.
// WHY THIS ANNOTATION EXISTS: the RATCHET LOG above is seven deliberate raises, dated and detailed,
// and it reads as the live control loop. A 2026-08-17 review brief cited it exactly that way ("the
// cap — BUILT, NOT BINDING, BLOCK_BYTES = 825,000") and drew a governance conclusion from a constant
// no push has been gated on for four days. Same shape as the 08-03 entry's dead deferral claim:
// a dated log is read as current state. `node scripts/check-band-budget.mjs --check` prints the
// effective ceiling — quote THAT, never this constant.
// ── THE BINDING CEILING (2026-09-21) ─────────────────────────────────────────────────────────
// A two-item recommendation was approved in full; its second item was to narrow the ceiling to
// what actually loads. This is that narrowing.
//
// WHAT CHANGED: the ceiling comparison used to run on the WHOLE gated plane (CLAUDE.md + AGENTS.md +
// every .claude/rules/*.md), of which 16 of 21 files are `paths:`-scoped and cost NOTHING on a turn
// that touches none of their globs. The 2026-08-18 note under FLOOR governor already said that plane
// was "the WRONG PLANE now that files can be path-scoped", and the note at PATH-SCOPED DETECTION
// already said moving the gate off it needed a deliberate decision, not a session's call. That
// decision has now been made.
//
// MEASURED, and it is why the old arrangement was worse than untidy — the two planes move in
// OPPOSITE directions (origin/main, `git ls-tree` + frontmatter read at each ref):
//     2026-08-24   always 384,243   scoped 229,798
//     2026-09-01   always 320,663   scoped 349,047
//     2026-09-07   always 284,200   scoped 382,332
//     2026-09-14   always 208,160   scoped 491,195
//     2026-09-21   always 216,807   scoped 505,126
// The always-loaded plane SHRANK 44% while the scoped plane grew 120%. Every BLOCK this gate issued
// in that window was overwhelmingly driven by growth in files that do not load on an ordinary turn,
// while the quantity the gate exists to protect was being cut.
//
// THE GAMING PATH IS NOT LEFT OPEN, and closing it is why the corpus ceiling SURVIVES rather than
// being deleted. PATH-SCOPED DETECTION's standing objection is that gating the narrow plane "opens a
// gaming path (add `paths:` to buy headroom)". It does — if scoping moves bytes out of EVERY budget.
// Here it moves them from the tight budget to the loose one, so the lever still costs something and
// total corpus growth is still bounded. ⚠️ THIS IS STRICTER THAN THE APPROVAL LITERALLY AUTHORISED:
// narrowing to what actually loads would permit dropping the corpus bound entirely. Keeping it is
// a deliberate tightening, stated here so a later reader does not mistake it for scope creep.
//
// SIZING — RE-DERIVED 2026-09-21, AND THE VERSION IT REPLACES IS THE MORE USEFUL HALF. It read:
// "the always plane grew 208,160 -> 216,807 B over the 7 days to 2026-09-21, i.e. ~1,236 B/day.
// A 23,193 B margin over the 2026-09-21 HEAD reading is ~19 days of that rate." Every number in
// that sentence was correct when written, and the margin was FALSE within the same session —
// the shell-traps split moved most of this plane out from under it, so the real margin is now
// several times the stated 23,193 B and the "~19 days" is correspondingly wrong.
// ⛔ THE GROWTH RATE IS THE DURABLE HALF; A MARGIN QUOTED AGAINST A SAME-DAY HEAD READING IS NOT.
// ⛔ AND NO LIVE FIGURE GOES IN THIS COMMENT AT ALL — the first draft of this correction wrote one
// and it was stale between being computed and being typed (145,262 vs 145,761 B, ~500 B of fleet
// writes, minutes apart). A shared-tree byte count is true only at the instant it is taken.
// DERIVE IT: run the gate, which prints both planes live.
// ⭐ The reusable lesson: a commit's prose about ONE file is falsified by the same
// session's edit to ANOTHER, and both files stay internally consistent, so re-reading either one
// passes. Nothing in the toolchain looks across the pair.
// Baseline PASSES at ship, growth blocks — the same ratchet-at-current discipline
// BLOCK_BYTES itself uses.
const ALWAYS_BLOCK_BYTES = 240_000;   // binding ceiling: CLAUDE.md + AGENTS.md + UNSCOPED .claude/rules/*.md
const ALWAYS_WARN_BYTES  = 235_000;   // 5 KB standoff, matching the corpus pair below

const WARN_BYTES = 820_000;   // compress-before-adding zone (a NEW always-loaded rule must DISPLACE an equal amount)
const BLOCK_BYTES = 825_000;  // HARD ceiling / ratchet backstop — the LIVE ceiling is min(this, observedMin+margin)

// ── FLOOR governor (2026-08-18) — WARN ONLY, and the mode is the decision ────────────
// The ceiling above gates the FULL on-disk total, which is the WRONG PLANE now that files can be
// path-scoped, and wrong in the PERVERSE direction: scoping a file adds its "this file is scoped"
// notice to disk, so the total RISES while delivery FALLS. Measured today — four scoping commits
// each read as growth here while 168.9 KB left the default delivery.
//
// So the floor gets its own line. It is NOT a replacement for the ceiling and NOT relief:
//   - gating on the floor ALONE would drop the measured number (looser), and this file's ratchet
//     contract is that the ceiling may only ever tighten;
//   - it would also open a gaming path — add `paths:` to a file to buy always-loaded headroom.
//   The ceiling keeps bounding total corpus growth; the floor bounds what is paid every turn.
//
// WARN, NOT BLOCK, DELIBERATELY (session-cadence.md § SHIP THE GUARD IN WARN MODE). This is
// a NEW detector on a fleet-wide BLOCKING push path with no observed false-positive rate. A
// too-tight floor here breaks every seat's push to protect a budget nobody has yet been held to.
// PROMOTION TRIGGER: after 5 observed FLOOR-warn fires classified use-vs-mention (did the author
// actually add always-loaded bytes, or merely trip it while scoping?), with zero false positives.
// Until then a breach is a conversation, not a refusal.
const FLOOR_WARN_BYTES = 400_000;  // floor measured 395,674 B at ship — ~4 KB of working margin

// ── ONE-WAY RATCHET (2026-08-13) ─────────────────────────────────────────────────────────────
// The log above is five up-moves and one down-move, and the down-move was a relocation. A limit
// that only ever rises is not a governor — the header has said so since 2026-07-11 while the
// number went 236 → 330 → 400 → 440 → 473 → 825 KB. This design makes the asymmetry
// mechanical instead of aspirational: DOWN is automatic after a cut, UP stays a documented,
// reviewed edit to BLOCK_BYTES above.
//
//   effectiveCeiling = min(BLOCK_BYTES, observedMin + marginBytes)
//
// so a displacement that drops the band by N drops the ceiling by N, and the bytes cannot be
// silently re-spent. Measured 2026-08-13: 39% of the corpus's largest-ever displacement regrew
// within ~24 hours with nothing to notice — that regrowth is what this closes.
//
// STATE lives in scripts/band-ratchet.json (tracked). WRITES happen ONLY under `--ratchet`:
//   · `--check` is contracted READ-ONLY by defer-trigger-scan's EXIT_ZERO_TARGETS exact-command
//     allowlist — a write there breaks a fleet contract another script depends on.
//   · the default no-flag mode is what .githooks/pre-push runs; a gate that mutates a TRACKED file
//     mid-push dirties the tree on a many-writer repo (the documented sweep/lost-update hazard) and
//     publishes a tree whose ratchet value differs from the local one. Neither is worth automating.
// The ceiling still TIGHTENS with no further action the moment a lower min is recorded, and every
// run PRINTS the exact command when a down-move is available. Missing/corrupt file → fall back to
// BLOCK_BYTES (fail-safe: the ratchet can only ever make the gate stricter, never weaker).
const RATCHET_FILE = join(ROOT, "scripts", "band-ratchet.json");

// ⛔ ENOENT and CORRUPT are DIFFERENT states (2026-08-13): a missing file is
// legitimately pre-adoption (null → hard ceiling), but a present-but-unparseable file used to fall
// back to the hard ceiling too — silently WIDENING the live ceiling by the whole ratcheted margin
// (19,285 B the day this was caught, growing with every future ratchet) while printing "no state
// file" about a file that exists. A one-way ratchet that forgets its floor on a parse error is not
// one-way. parseRatchet is pure so the self-test can arm the sentinel.
function parseRatchet(text) {
  try {
    const j = JSON.parse(text);
    const observedMin = Number(j.observedMin);
    const marginBytes = Number(j.marginBytes);
    if (!Number.isFinite(observedMin) || !Number.isFinite(marginBytes)) return "CORRUPT";
    if (observedMin <= 0 || marginBytes < 0) return "CORRUPT";
    return { observedMin, marginBytes, raw: j };
  } catch { return "CORRUPT"; }
}
function readRatchet() {
  let text;
  try { text = readFileSync(RATCHET_FILE, "utf8"); }
  catch { return null; }                       // ENOENT: pre-adoption, hard ceiling applies
  return parseRatchet(text);
}

// The ratchet may only LOWER the ceiling. If the state file is missing, unparseable, or would
// RAISE the ceiling above BLOCK_BYTES, BLOCK_BYTES wins.
function effectiveLimits(ratchet) {
  if (!ratchet) return { block: BLOCK_BYTES, warn: WARN_BYTES, ratcheted: false };
  const block = Math.min(BLOCK_BYTES, ratchet.observedMin + ratchet.marginBytes);
  const standoff = BLOCK_BYTES - WARN_BYTES;          // preserve the 5 KB warn standoff
  return { block, warn: Math.max(0, block - standoff), ratcheted: block < BLOCK_BYTES };
}

// ── THE UP-MOVE RITUAL (2026-09-21) ──────────────────────────────────────────────────────────
// The design said an UP move on the corpus ceiling belongs in BLOCK_BYTES under the RATCHET LOG.
// PRACTICE did it twice as a hand re-baseline of observedMin here, recorded as a history entry
// quoting the owner. Those are two different rituals and the file asserted the first while the
// fleet performed the second, so the log could not be read as governance. The resolution: the
// PRACTICE is the real ritual, and a raise whose entry does not quote the owner's approval is refused.
//
// Two checks, and the FIRST is the one that catches the likely mistake. A hand-edit that raises
// observedMin and writes no history entry leaves the value and its own log disagreeing, which no
// amount of prose can detect; the second check only ever sees moves somebody bothered to record.
//
// ⚠️ WHAT THIS CANNOT DO: it reads the NOTE, so it verifies that a quotation is PRESENT, never
// that the owner said it. A fabricated quote passes. That is the ceiling of a mechanical check
// on a prose field and it is stated rather than papered over — the check exists to stop a silent
// raise, not to authenticate one.
function ratchetGovernance(raw) {
  const problems = [];
  const h = Array.isArray(raw?.history) ? raw.history : [];
  if (!h.length) return problems;

  const last = h[h.length - 1];
  const top = Number(raw?.observedMin);
  if (Number.isFinite(top) && Number(last?.observedMin) !== top) {
    problems.push(`observedMin is ${top} but the newest history entry records ${last?.observedMin}. `
      + `A re-baseline is the history entry — edit both, or the log is not the record.`);
  }
  for (let i = 1; i < h.length; i++) {
    const prev = Number(h[i - 1]?.observedMin);
    const cur = Number(h[i]?.observedMin);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || cur <= prev) continue;
    const note = String(h[i]?.note ?? "");
    const m = /owner\s+verbatim\s*:/i.exec(note);
    const quoted = m ? note.slice(m.index + m[0].length).trim() : "";
    const ok = quoted.length >= 15 && /^['"‘“]/.test(quoted);
    if (!ok) {
      problems.push(`history entry ${i} RAISES observedMin ${prev} -> ${cur} without quoting an owner `
        + `ruling. An UP move is the owner's call: the entry must carry \`owner verbatim: '<the owner's words>'\`.`);
    }
  }
  return problems;
}

// A down-move is AVAILABLE when the published band is lower than anything recorded. Refuses an
// implausible collapse: a >25% drop is likelier a broken instrument or a mid-surgery tree than a
// real cut, and accepting one locks the whole fleet's ceiling to a transient value. Refusing only
// makes the ratchet lag (recoverable by re-running, or by editing the file); accepting a bogus
// value blocks every push. Fail-safe direction chosen deliberately.
const RATCHET_MAX_DROP_FRACTION = 0.25;

function ratchetProposal(ratchet, headTotal) {
  if (!ratchet) return { kind: "no-state" };
  if (headTotal === null || !Number.isFinite(headTotal) || headTotal <= 0) return { kind: "no-measurement" };
  if (headTotal >= ratchet.observedMin) return { kind: "none", headTotal };
  const drop = ratchet.observedMin - headTotal;
  if (drop > ratchet.observedMin * RATCHET_MAX_DROP_FRACTION) {
    return { kind: "implausible", headTotal, drop };
  }
  return { kind: "available", headTotal, drop };
}

// ── THE TWO PLANES (2026-08-24, band write-path panel) ───────────────────────────────────────
// This file measures TWO always-loaded sets that are paid on DIFFERENT cost curves, and for nine
// days it gated one against a ceiling derived from the other.
//
//   GATED       CLAUDE.md + AGENTS.md + .claude/rules/**.md — cached prefix, re-delivered to every
//               sub-agent dispatch. This is the plane `observedMin` was ratcheted on (every entry
//               in band-ratchet.json's history is a `baselineTotal()` reading), the plane the delta
//               arm reads, and therefore the ONLY plane the ceiling comparison is valid on.
//   ORCHESTRATOR .claude/orchestrator/*.md — Band-O, injected per-turn by band-o-inject.sh into the
//               ORCHESTRATOR ONLY. Sub-agents never fire UserPromptSubmit, so they never receive it.
//
// ⛔ WHAT WENT WRONG, so nobody re-merges them: the 2026-08-15 change that added Band-O to
// bandFiles() was scoped as visibility only, with no threshold moving. Its implementation put Band-O
// into `total`, and `render()` classified `total` against a ceiling that had never contained it —
// so the printed breach carried 19,345 B of phantom overage (measured 2026-08-24: reported 29.8 KB
// over, true gated overage 10.4 KB, 65% artifact). That stated scope is the fix: Band-O stays
// MEASURED and REPORTED, and leaves the GATED comparison.
//
// ⛔ AND DO NOT "FIX" THIS THE OTHER WAY — the header's standing prohibition still binds: per-turn
// bytes and cached-prefix bytes are different COST CURVES, and summing across curves is the unit
// error this file was written to fix. Folding Band-O into the ceiling would ALSO silently raise the
// effective ceiling's meaning by 19 KB against a ratchet contract that may only ever tighten.
//
// ONE SSOT, TWO CONSUMERS. `GATED_PATHSPEC` is what the git-tree readers hand to `ls-tree`;
// `classifyBandPath()` is what the worktree reader applies to each measured file. They MUST agree,
// and `--self-test` asserts they do — the defect above existed precisely because two hand-written
// path lists drifted with nothing comparing them.
const GATED_PATHSPEC = ["CLAUDE.md", "AGENTS.md", ".claude/rules/"];

// PER-FILE scope is DELIBERATELY WIDER than the band's, and the two must not be merged.
// The band total prices ALWAYS-LOADED bytes — context paid on every turn — so a skill spec has no
// business in it: specs load on invocation, not per turn, and adding ~107 of them would blow a
// ceiling calibrated for a different quantity and block the fleet instantly.
// The HARNESS READ LIMIT has no such scoping: it degrades ANY file past the cap, whoever reads it
// and however it is loaded. That is why the per-file arm gets its own pathspec. It also closes the
// gap the SCOPE NOTE in perFileOffendersAtRef named and left open on 2026-08-24.
const PER_FILE_PATHSPEC = [...GATED_PATHSPEC, ".claude/skills/", ".claude/orchestrator/"];

// WARN-vs-BLOCK per TIER, per warn-before-block: hard-block only where the baseline PASSES.
// It passes on the gated plane (largest 137,212 B < 140,000 chars) and does NOT pass on the newly
// watched corpus — wrap/SKILL.md 171,335 chars and expert-review/SKILL.md 158,585 at origin/main,
// both over the limit. Blocking those today refuses every push on the plane, including the
// compressions that fix them — the exact trap this session removed from the gated arm.
// PROMOTION CONDITION so this cannot sit at warn forever: when every path returning "warn" measures
// under PER_FILE_BLOCK_CHARS, return "block" here and the baseline passes by construction.
function perFileEnforcement(rel) {
  if (classifyBandPath(rel) === "gated") return "block";
  // SKILL.md ONLY, and the exclusion is the substance of this scope rather than tidying.
  // A SKILL.md is DELIVERED WHOLE by the skill mechanism — measured 2026-09-25: 7 of 7 /wrap invocations
  // delivered 177,086-183,321 chars with the file's last line present, so the 150,000-char line does NOT
  // truncate the invocation path; this tier is a size-growth signal, not a delivery limit.
  // A MEMORY-ARCHIVE / CHANGELOG-ARCHIVE / RULES-SHARD file is the
  // opposite: memory-tier-split.mjs shards those to ~200 KB ON PURPOSE and the codified retrieval
  // path is grep-the-dir then Read with an offset, never a bare whole-file read. Watching them
  // reports a deliberate design as 50+ violations — measured when this arm first widened: 59 rows,
  // 56 of them paged archives, which is a gate training its operator to ignore it.
  // references/*.md are excluded for the same reason (read by anchor; one such reference file runs to
  // 212,633 chars by design).
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(rel)) return "warn";
  if (/^\.claude\/orchestrator\/.+\.md$/.test(rel)) return "warn";
  return null;   // not watched by the per-file arm at all
}

// Repo-relative path -> which plane it is paid on. "unclassified" is a REAL third state and the
// self-test refuses it: the 2026-08-15 failure was a file entering the measured set with nobody
// deciding which plane it belonged to, and a two-way partition would have silently absorbed it.
function classifyBandPath(rel) {
  if (rel === "CLAUDE.md" || rel === "AGENTS.md") return "gated";
  if (/^\.claude\/rules\/.+\.md$/.test(rel)) return "gated";          // subdir-tolerant
  // 2026-09-03 (on the dispatch-payload relocation): the orchestrator dir now holds TWO cost
  // curves. Band-O (active-recall-orchestrator.md) is injected on EVERY orchestrator turn by
  // band-o-inject.sh; conventions / commit-doctrine / session-doctrine are injected ONCE per session
  // epoch (startup|resume|clear|compact) by orchestrator-inject.sh and then ride the cached prefix —
  // the same curve as the gated plane, but sub-agents never receive them. Reporting them as per-turn
  // multiplied the Band-O line ~5.8x (measured the day they landed). Third plane, own line.
  if (rel === ".claude/orchestrator/active-recall-orchestrator.md") return "orchestrator";
  if (/^\.claude\/orchestrator\/.+\.md$/.test(rel)) return "session";
  return "unclassified";
}

// Does GATED_PATHSPEC actually reach this path? A pathspec entry is either an exact file or a
// directory prefix. This is the arm that would have RED-ed in 2026-08-15: orchestrator files were
// in the measured total and reachable by NO pathspec entry.
function coveredByGatedPathspec(rel) {
  return GATED_PATHSPEC.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
}

function bandFiles() {
  const files = [join(ROOT, "CLAUDE.md"), join(ROOT, "AGENTS.md")];
  const rulesDir = join(ROOT, ".claude", "rules");
  if (existsSync(rulesDir)) {
    // RECURSIVE (2026-08-13): the pre-push trigger regex matches subdirectory rules
    // files while the old non-recursive walk did not measure them — a simultaneous trigger-without-
    // measure fail-open in both guards. No subdir exists today; recursive is the fail-safe direction.
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith(".md")) files.push(join(d, e.name));
      }
    };
    walk(rulesDir);
  }
  // ORCHESTRATOR BAND (2026-08-15): .claude/orchestrator/*.md is injected into every
  // orchestrator turn by band-o-inject.sh (UserPromptSubmit), so it is always-loaded in the only
  // sense this budget measures — bytes paid on every turn — and it was invisible here.
  // A 2026-07-11 tracker row PREDICTED this exact class ("the first always-loaded file added
  // outside bandFiles()'s set"); Band-O was created the next day and went uncounted for ~5 weeks,
  // through a 2026-08-13 panel that touched this very function to make the rules walk recursive.
  // Measured at inclusion: band 712.1 KB -> 730.8 KB against a 764.4 KB warn line, so counting it
  // breaches nothing. This ADDS VISIBILITY ONLY — no threshold moves, and the governors stay WARN
  // by an earlier decision.
  // ⚠️ THAT LAST SENTENCE WAS THE INTENT AND NOT THE BEHAVIOUR UNTIL 2026-08-24: these files landed
  // in `total`, and `render()` gated `total`. bandFiles() still returns them — the MEASURED set is
  // correct and must stay — but `measure()` now partitions by classifyBandPath() above, so they are
  // reported on their own line and never enter the ceiling comparison. See THE TWO PLANES.
  const orchDir = join(ROOT, ".claude", "orchestrator");
  if (existsSync(orchDir)) {
    for (const e of readdirSync(orchDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() && e.name.endsWith(".md")) files.push(join(orchDir, e.name));
    }
  }
  return files;
}

// PATH-SCOPED DETECTION (2026-08-18). A rules file carrying YAML `paths:` frontmatter is NOT
// injected into every session — the harness loads it only when Claude READS a file matching its
// globs (vendor spec: code.claude.com/docs/en/memory § Path-specific rules; proven in a throwaway
// repo on CLI 2.1.234 — src/app/api/** fired on a matching read, src/** and src/lib/ai/prompts/**
// excluded when unmatched, unscoped control present).
//
// ⛔ THIS GATE'S PREMISE IS "BYTES PAID ON EVERY TURN", SO A SCOPED FILE IS THE WRONG PLANE — and
// the gate could not see the difference. Measured 2026-08-18: scoping four files took 135,668 B
// (25.0%) out of the default delivery while this gate REPORTED A RISE, because the scoping notices
// added on-disk bytes. Every number it has printed about scoping is wrong in that direction.
//
// VISIBILITY ONLY, DELIBERATELY. ⛔ CORRECTED 2026-08-24: this sentence read
// "`classify()` still runs on the FULL total", present tense, and that is now FALSE — it runs on
// `gatedTotal` (see render(), the classify call on the gated subtotal). The safety property it was
// asserting SURVIVES and is now stronger, because the ceiling is calibrated on the same gated
// plane: nothing here can
// loosen a blocking fleet-wide gate. Moving the gate onto alwaysTotal would DROP the measured
// number and this file's own ratchet contract says the ceiling may only ever tighten — that is an
// OWNER decision, and it also opens a gaming path (add `paths:` to buy headroom) which is exactly
// why the scoped subtotal is PRINTED rather than silently subtracted.
//
// Strict by construction: frontmatter must start at byte 0, must close, and must carry a `paths:`
// key — a stray `---` rule or a `paths:` mention in prose cannot false-positive.
function isPathScopedText(head) {
  if (typeof head !== "string" || !head.startsWith("---")) return false;
  const end = head.indexOf("\n---", 3);
  if (end === -1) return false;
  return /^\s*paths\s*:/m.test(head.slice(3, end));
}

// ONE SSOT, TWO CONSUMERS (the same discipline GATED_PATHSPEC/classifyBandPath already carry):
// the WORKTREE reader below and the REF reader `alwaysTotalAt()` must apply the identical predicate,
// or the gate's level and its delta would be measured on two different definitions of "scoped".
// --self-test pins them to one function.
function isPathScoped(file) {
  let head;
  try { head = readFileSync(file, "utf8").slice(0, 400); } catch { return false; }
  return isPathScopedText(head);
}

// Rows are [relpath, bytes, isScoped, plane]. `plane` (2026-08-24) is what keeps the ceiling
// comparison on the set the ceiling was derived from — see THE TWO PLANES above.
function measure(files) {
  const rows = [];
  let total = 0;
  let scopedTotal = 0;
  let orchTotal = 0;
  let sessionTotal = 0;
  let unclassified = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const b = statSync(f).size;
    const scoped = isPathScoped(f);
    const rel = f.replace(ROOT + "/", "");
    const plane = classifyBandPath(rel);
    total += b;
    if (scoped) scopedTotal += b;
    if (plane === "orchestrator") orchTotal += b;
    if (plane === "session") sessionTotal += b;
    if (plane === "unclassified") unclassified.push(rel);
    rows.push([rel, b, scoped, plane]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  // The number the ceiling, the ratchet and the delta all speak. NEVER `total`.
  return { total, gatedTotal: total - orchTotal - sessionTotal, orchTotal, sessionTotal, scopedTotal, unclassified, rows };
}

const kb = (n) => (n / 1000).toFixed(1) + " KB";  // decimal KB, matching the audit's "245 KB" framing

// ── DELIVERED PLANE (L3 — 2026-08-18) ──
// Every other number in this file is a SOURCE-plane reading: bytes on disk. That answers "how big are
// the files", never "how much actually arrived", and the two diverge in both directions:
//   · path-scoping REMOVES a file from most deliveries while ADDING on-disk bytes (its scoping notice),
//     so the source plane scored four scopings as a RISE — every scoping number this gate printed was
//     wrong in that direction until `isPathScoped()` split the floor out;
//   · a COMPACTION re-delivers the whole resident set, so the real cost is per-compaction, not
//     per-session, and no source-plane reading can see that multiplier at all.
//
// ⛔ OBSERVATIONAL. NOTHING HERE GATES, AND THAT IS THE DECISION, NOT AN OVERSIGHT. L3 was chosen
// alone — build L3, let it read a week of real deliveries, then ask the L2 question against
// numbers instead of estimates — so this ships as a MEASUREMENT whose job is to make the next
// decision checkable. Moving the block onto this plane would also be unsound today: the log records
// PATHS, not sizes-at-delivery, so every byte figure below is CURRENT size attributed to a PAST
// delivery — good enough to compare planes, not good enough to refuse a push.
//
// TWO WAYS IT COULD MISLEAD, both surfaced rather than smoothed:
//   · a delivered path since DELETED cannot be sized. Counted as `unsizable` and NOT silently 0 —
//     otherwise a deletion reads as a saving, which is the direction that flatters the corpus.
//   · a delivery EVENT is (session_id, prompt_id), not a record. 320 records were 33 events when this
//     shipped; counting records would overstate event volume ~10x.
const DELIVERY_LOG = join(ROOT, ".claude", "logs", "instructions-loaded.jsonl");

function deliveredPlane(logPath = DELIVERY_LOG, sizeOf = null) {
  const size = sizeOf || ((p) => {
    const abs = p.startsWith("/") ? p : join(ROOT, p);
    if (!existsSync(abs)) return null;
    try { return statSync(abs).size; } catch { return null; }
  });
  let text;
  try {
    if (!existsSync(logPath)) return null;
    text = readFileSync(logPath, "utf8");
  } catch { return null; }
  const events = new Map();          // "sid|pid" -> { paths:Set, reasons:Set }
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { malformed++; continue; }
    if (!r || typeof r !== "object" || !r.file_path) { malformed++; continue; }
    const key = `${r.session_id ?? "?"}|${r.prompt_id ?? "?"}`;
    if (!events.has(key)) events.set(key, { paths: new Set(), reasons: new Set() });
    const e = events.get(key);
    e.paths.add(r.file_path);
    if (r.load_reason) e.reasons.add(r.load_reason);
  }
  if (events.size === 0) return null;
  const totals = [];
  const byReason = new Map();
  let unsizable = 0;
  for (const e of events.values()) {
    let bytes = 0;
    for (const p of e.paths) {
      const b = size(p);
      if (b === null) { unsizable++; continue; }
      bytes += b;
    }
    totals.push(bytes);
    // An event can carry several reasons (a compaction that also glob-matches). Attribute to the
    // WIDEST one present — compaction dominates cost and is the reading the decision turns on.
    const reason = e.reasons.has("compact") ? "compact"
      : e.reasons.has("session_start") ? "session_start"
      : (e.reasons.values().next().value ?? "unknown");
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(bytes);
  }
  totals.sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  return {
    events: events.size,
    median,
    max: totals[totals.length - 1],
    total: totals.reduce((s, n) => s + n, 0),
    unsizable,
    malformed,
    byReason: [...byReason.entries()]
      .map(([k, v]) => [k, v.length, v.reduce((s, n) => s + n, 0) / v.length])
      .sort((a, b) => b[1] - a[1]),
  };
}

function renderDelivered(d, sourceTotal) {
  if (!d) return [];
  const lines = [
    `  ── DELIVERED plane (observational, never gates) — ${d.events} delivery events in ${DELIVERY_LOG.replace(ROOT + "/", "")}`,
    `     median event ${kb(d.median)} · largest ${kb(d.max)} · cumulative ${kb(d.total)} across all events`,
  ];
  for (const [reason, n, mean] of d.byReason) {
    lines.push(`     ${reason.padEnd(14)} ${String(n).padStart(4)} events · mean ${kb(mean)}`);
  }
  const compact = d.byReason.find(([r]) => r === "compact");
  if (compact) {
    lines.push(`     ⇒ a COMPACTION re-delivers ~${kb(compact[2])}; source-plane total is ${kb(sourceTotal)}. The cost is per-compaction, not per-session.`);
  }
  if (d.unsizable > 0) {
    lines.push(`     ⚠️  ${d.unsizable} delivered path(s) no longer exist and were NOT counted as 0 — the figures above are an UNDER-count, not a saving.`);
  }
  if (d.malformed > 0) lines.push(`     ⚠️  ${d.malformed} unparseable log line(s) skipped.`);
  lines.push(`     Sizes are CURRENT on-disk, attributed to PAST deliveries — the log records paths, not sizes-at-delivery.`);
  return lines;
}

// ── DELTA-GATING (2026-07-31) ────────────────────────────────────────────────────────────────
// Ships the standing candidate the 2026-07-29 ratchet log named and deferred: "the gate is still
// LEVEL-only and DIRECTION-BLIND (classify() reads `total` alone), so while over the ceiling it
// rejects a push that CUTS bytes exactly as it rejects one that adds."
//
// Why that mattered enough to build: the same log records that the sanctioned remedy was
// ARITHMETICALLY UNABLE to reach the target — ~19-20 KB recoverable against a 41.7 KB overage. So
// in the exact regime that produced the raise, a full clearance is unreachable and INCREMENTAL is
// the only available move — which is precisely what a level-only gate forbids. Its predictable
// resolution is SKIP_BAND_BUDGET_CHECK=1, which had already been used once. A gate
// whose recurring resolution is its own escape hatch is a gate in name only.
//
// Purity note: `--check` is contracted read-only (defer-trigger-scan EXIT_ZERO_TARGETS). This adds
// ONE `git ls-tree` — a read, no writes, no network. Sizes come straight from the tree objects, so
// no blob contents are materialised.
// ⛔ NO "HEAD" FALLBACK (2026-08-13): HEAD always resolves, so a "HEAD" rung made the
// null branch below unreachable and — worse — baseline=HEAD forces delta ≡ 0, which routes an
// over-ceiling push into gateDecision's "not growing → ALLOW" branch. A BLOCK gate failing OPEN
// on every fresh clone / renamed remote. The MONOTONE-ladder rule: each fallback rung must be at
// least as strict as the rung below it; "HEAD" was strictly MORE permissive than null → BLOCK.
// BRANCHING POLICY (2026-09-08): once `origin/dev` exists it
// is the branch every push publishes to, so it is "what is already published" for a band push
// gate; `origin/main` is the promote baseline and the pre-cutover fallback. Ordered most-specific
// first; the MONOTONE-ladder rule above is about HEAD, which never enters this list.
const BASELINE_REFS = ["origin/dev", "origin/main"];  // a push gate asks "vs what is already published"

function resolveBaseline() {
  for (const ref of BASELINE_REFS) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
        { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
      return ref;
    } catch { /* not resolvable here — try the next */ }
  }
  return null;  // detached//fresh clone/no remote → caller falls back to level-only, never fail-open
}

// Byte total of the GATED plane at `ref`. A band file absent at the baseline contributes 0, so a
// newly-added rule file reads as pure growth — which is correct.
//
// ⛔ THIS IS THE GATED PLANE, NOT bandFiles(). The comment here read "mirror bandFiles()" from
// 2026-07-31 until 2026-08-24 and was FALSE from 2026-08-15 onward, when Band-O joined bandFiles()
// and did not join this pathspec. The right reading is the opposite of what that comment invited:
// this function is CORRECT and bandFiles() is DELIBERATELY WIDER — it measures both planes, and
// measure() partitions them. Everything this function feeds is ceiling-facing and must stay on the
// gated plane: `observedMin` (every --ratchet write), the delta arm's two operands, and the gate's
// own level via computeGateLevel(). See THE TWO PLANES above; the shared SSOT is GATED_PATHSPEC +
// classifyBandPath(), and --self-test asserts the two readers cannot drift apart again.
function baselineTotal(ref) {
  if (!ref) return null;
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "-l", ref, "--", ...GATED_PATHSPEC],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch { return null; }
  let total = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    if (classifyBandPath(path) !== "gated") continue;
    const size = Number(line.slice(0, tab).trim().split(/\s+/)[3]);
    if (Number.isFinite(size)) total += size;
  }
  return total;
}

// Byte total of the ALWAYS-LOADED plane at `ref` — the gated plane MINUS every `paths:`-scoped file,
// i.e. what a turn touching none of their globs actually pays. Sibling of baselineTotal(), which
// stays on the CORPUS plane because observedMin and the corpus delta were both calibrated there.
//
// ⛔ A BLOB IT CANNOT READ IS COUNTED, NOT SKIPPED. An unreadable head is indistinguishable from an
// unscoped one here, and the two failure directions are not symmetric: counting it can only make the
// ceiling STRICTER, while skipping it would silently shrink the measured plane and loosen a blocking
// fleet-wide gate (bash-environment.md § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE).
function alwaysTotalAt(ref) {
  if (!ref) return null;
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "-l", ref, "--", ...GATED_PATHSPEC],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch { return null; }
  let total = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    if (classifyBandPath(path) !== "gated") continue;
    const fields = line.slice(0, tab).trim().split(/\s+/);
    const sha = fields[2];
    const size = Number(fields[3]);
    if (!Number.isFinite(size)) continue;
    let head = "";
    try {
      head = execFileSync("git", ["cat-file", "blob", sha],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 20 }).slice(0, 400);
    } catch { /* unreadable -> falls through as UNSCOPED, i.e. counted */ }
    if (isPathScopedText(head)) continue;
    total += size;
  }
  return total;
}

// Severity order for combining two independent plane verdicts. The WORSE one wins, so neither plane
// can be relieved by the other being healthy.
const LEVEL_RANK = { ok: 0, warn: 1, block: 2 };
function worseLevel(a, b) {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// THE gate decision — LEVEL says where the band is, DELTA says which way this push moves it.
// Single path, exercised by both main() and selfTest() (same discipline as classify()).
// The gate LEVEL operand reads the HEAD plane: the worktree level passes
// through only when HEAD is unresolvable — where delta is null too and gateDecision's null branch
// already blocks when over. Extracted so the self-test pins the plane (panel: reverting this to
// bare `level` left the whole suite green).
function computeGateLevel(level, headTotal, limits, headAlways) {
  if (headTotal === null) return level;
  const corpus = headTotal > limits.block ? "block" : "ok";
  // headAlways undefined/null => the binding plane could not be read at HEAD, so it contributes
  // nothing rather than fabricating an "ok". Callers that pass three arguments keep the old
  // behaviour exactly, which is what lets the pre-2026-09-21 self-test arms stay valid.
  if (headAlways === undefined || headAlways === null) return corpus;
  return worseLevel(corpus, headAlways > ALWAYS_BLOCK_BYTES ? "block" : "ok");
}

function gateDecision(level, delta) {
  if (level !== "block") return { block: false, why: `level=${level}` };
  if (delta === null)    return { block: true,  why: "over ceiling; baseline unresolved → level-only fallback (fail-safe)" };
  if (delta > 0)         return { block: true,  why: `over ceiling AND this push GROWS the band by ${delta} B` };
  return { block: false, why: `over ceiling, but this push does not grow the band (${delta} B) — allowed so a cut can land` };
}

// The ONE classification path — both main() and selfTest() call this, so the self-test exercises the real
// detection logic, not a mirror of it.
// ── PER-FILE ceiling ──────────────────────────────────────────────────────────────────────────
// The harness caps an INDIVIDUAL always-loaded file, and this gate was blind to it by construction:
// classify() reads `total` alone. Measured 2026-08-12 — bash-environment.md crossed the limit while
// the band sat at 713/825 KB and reported perfectly clean; the only thing that noticed was the
// harness's own startup banner, which no gate reads.
//
// CHARS, NOT BYTES, deliberately. The harness limit is a CHARACTER count, and this corpus has already
// been bitten once by "correcting" a char cap to bytes (the Band-O chunk cap: both chunks exceed 9,500
// BYTES while under 9,500 CHARS, so a unit flip would have truncated them fleet-wide). statSync is the
// cheap pre-filter only — for UTF-8, bytes >= chars, so a file under the byte threshold is under the
// char threshold and can be skipped without reading it.
//
// BLOCK, not warn: at adoption the largest band file was 117,158 chars, i.e. the baseline PASSES, and
// the structural-impossible option is preferred whenever it does. Escape is
// the existing SKIP_BAND_BUDGET_CHECK=1.
const PER_FILE_WARN_CHARS = 140_000;
const PER_FILE_BLOCK_CHARS = 150_000;

function perFileOffendersAtRef(ref) {
  // SAME PLANE AS THE BAND GATE — what the push PUBLISHES, never the worktree. Gating this on the
  // worktree would reproduce the mixed-plane fail-open documented at the delta below: an over-limit
  // file committed at HEAD with a smaller mid-edit worktree would read clean and ship.
  // ls-tree gives BYTES; bytes >= chars for UTF-8, so anything under the threshold in bytes is under
  // it in chars and needs no read. Only candidates get a content read, so this costs 1 spawn + ~0.
  if (!ref) return null;
  let out;
  try {
    out = execFileSync("git", ["ls-tree", "-r", "-l", ref, "--", ...PER_FILE_PATHSPEC],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch { return null; }
  const cands = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    // SCOPE NOTE (2026-08-24): gated plane only, and that is a real gap rather than a decision —
    // Band-O is subject to the same harness per-file limit. It does not bind today (19.3 KB against
    // a 150,000-char limit) and band-o-inject.sh clamps its own chunks besides, so widening this
    // would add a spawn per run to check a file two orders of magnitude clear. Revisit if any
    // .claude/orchestrator/*.md passes 100 KB.
    if (perFileEnforcement(path) === null) continue;
    const size = Number(line.slice(0, tab).trim().split(/\s+/)[3]);
    if (Number.isFinite(size) && size >= PER_FILE_WARN_CHARS) cands.push(path);
  }
  const offenders = [];
  for (const path of cands) {
    let content;
    try {
      content = execFileSync("git", ["show", `${ref}:${path}`],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch { continue; }
    if (content.length > PER_FILE_WARN_CHARS) offenders.push([path, content.length, perFileEnforcement(path)]);
  }
  return offenders.sort((a, b) => b[1] - a[1]);
}

function classifyPerFile(chars, warn = PER_FILE_WARN_CHARS, block = PER_FILE_BLOCK_CHARS) {
  if (chars > block) return "block";
  if (chars > warn) return "warn";
  return "ok";
}

// PER-FILE DELTA arm — the exact mirror of gateDecision()'s "allowed so a cut can land" branch,
// and it was MISSING for the whole life of the per-file ceiling. The band arm has consulted its
// delta since delta-gating shipped (2026-07-31); this one classified from the HEAD plane alone and the exit line ORs the
// two, so the band arm's allowance was UNREACHABLE whenever any file sat over the limit.
//
// What that cost: once a gated file crosses PER_FILE_BLOCK_CHARS, every push on the plane refuses —
// INCLUDING the compression push that would bring it back under, and including a peer who never
// opened the file. A ceiling you cannot climb down from is a trap, not a gate, and it is the one
// failure mode that gets a working gate reverted instead of fixed.
//
// PURE BY CONSTRUCTION (no git, no fs): the per-file arm is DORMANT on the real tree — the largest
// gated file measured 137,212 B when this shipped, under the 140,000-char warn — so a live run
// cannot exercise it and an in-repo fixture would have to manufacture a 150,000-char rules file.
// Taking both offender lists as arguments is what makes the branches reachable from --self-test.
//
// Absent-at-baseline is scored as 0, matching baselineTotal()'s documented convention ("a band file
// absent at the baseline contributes 0, so a newly-added rule file reads as pure growth"). A file
// that was under the WARN threshold at the baseline is legitimately absent from `baseOffenders`,
// and it did in fact grow past the limit, so BLOCK is the right reading rather than a rounding.
function perFileGateDecision(headOffenders, baseOffenders) {
  if (headOffenders === null) {
    // ⛔ WAS `block: false` UNTIL 2026-09-13, ON A PREMISE THAT IS FALSE — measured, folded here.
    // The old `why` deferred to the band delta's fail-safe. That deferee is designed never to be in
    // the state the deferral needs: `computeGateLevel(level, null, …)` returns the WORKTREE level,
    // not "block", and `gateDecision` blocks only when that level IS "block". The live tree sits at
    // 696,923 B against a 710,000 B ceiling, so the band arm reads "warn" and ALLOWS — and the
    // ratchet doctrine GUARANTEES the baseline passes, so it is always in the allowing state.
    // Measured on an unborn-HEAD rig with a 200,001-char always-loaded file, 33% past the harness
    // limit: nothing printed, nothing refused, EXIT=0. A per-file gate that cannot resolve HEAD
    // knows NOTHING about the tree it is gating; the only fail-safe reading is to refuse.
    return { block: true, why: "HEAD unresolvable — per-file gate cannot size any file, so it REFUSES (fail-safe); it does not defer to the band delta, which allows at warn tier" };
  }
  // TIER FILTER. An offender row is [path, chars, enforcement]; a 2-tuple (the gated-plane arms and
  // any older caller) defaults to "block", so widening the scope cannot silently downgrade the plane
  // that was already hard-gated. Only a "block"-tier file can refuse a push; "warn" tier prints and
  // is excluded here by design — see perFileEnforcement's promotion condition.
  const over = headOffenders.filter(
    ([, chars, enf]) => classifyPerFile(chars) === "block" && (enf ?? "block") === "block");
  if (over.length === 0) return { block: false, why: "no gated file over the harness limit" };
  if (baseOffenders === null) {
    return { block: true, why: `${over.length} file(s) over the limit; baseline unresolved -> fail-safe BLOCK` };
  }
  const baseBy = new Map(baseOffenders);
  const grew = over.filter(([path, chars]) => chars > (baseBy.get(path) ?? 0));
  if (grew.length === 0) {
    return { block: false, why: `${over.length} file(s) over the limit, but this push grows none of them — allowed so a cut can land` };
  }
  return { block: true, why: `over the limit AND this push GROWS ${grew.map(([path]) => path).join(", ")}` };
}

function classify(total, warn = WARN_BYTES, block = BLOCK_BYTES) {
  if (total > block) return "block";
  if (total > warn) return "warn";
  return "ok";
}

// ── THE TRAPS PLANE — A DELIBERATELY LOOSE CEILING (2026-09-21) ───────────────────────────
// `.claude/traps/` is in NEITHER band plane, because `GATED_PATHSPEC` counts CLAUDE.md, AGENTS.md
// and `.claude/rules/` only. That is CORRECT and not an oversight: these bytes are not carried
// per turn. They are delivered per MATCHING COMMAND by `shell-trap-inject.sh`, a few KB at a time.
//
// ⭐ THE KEY PROPERTY, and the reason this ceiling is loose rather than tight: DELIVERED bytes are
// bounded by that hook's own CAP no matter how big this file gets. Growing the table does not grow
// what any turn pays, so sizing this like a band ceiling would be pricing the wrong thing.
// ⛔ THE CAP IS READ OUT OF THE HOOK AT RUNTIME AND NEVER RESTATED HERE. This comment carried a
// literal `6,000 B` and was already 67% low when it was next read — a commit had raised the live value
// to 10,000 about two hours after this block shipped, and the whole loose-ceiling argument rests on
// that figure. The working precedent was three lines away in the file being edited: the injector's
// own `--self-test` reads CAP out of its source by regex precisely because a second copy is a drift
// bug waiting for whoever tunes one of them. That prediction came true in the sibling file inside
// two hours.
// The decision on this plane: a ceiling is optional here, and if one is kept it must not be a
// tight one.
//
// WHY ONE EXISTS AT ALL: an unmeasured corpus is how `bash-environment.md` reached 149 KB without
// anyone noticing. This is a TRIPWIRE against that, not a budget. 160 KB is ~2x the plane's size at
// adoption and roughly the size of the single file it was carved out of — reaching it means the
// table doubled, which is a thing somebody should have to look at, not a cost anyone is paying.
// ⚠️ The SECOND-ORDER cost of growth is real but is not bytes: more entries compete for the same
// per-command budget, so more get dropped. That is now VISIBLE (the notice names them), which is
// the instrument that actually governs this plane.
const TRAPS_BLOCK_BYTES = 160_000;
const TRAPS_WARN_BYTES = 150_000;

// Reads the live per-command CAP out of the injector's source. Returns null when the hook or the
// constant is absent — callers print "unknown" rather than a remembered number, because a stale
// figure here is exactly the defect this function exists to retire.
function liveInjectorCap(root = ROOT) {
  try {
    const src = readFileSync(join(root, ".claude", "hooks", "shell-trap-inject.sh"), "utf8");
    const m = /CAP,\s*MAX_RULES,\s*out,\s*used\s*=\s*(\d+)\s*,/.exec(src);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

// ⛔ CAP IS NOT THE PAYLOAD BOUND, AND PRINTING IT AS ONE IS HOW THIS FILE CAME TO STATE A LIVE SERIOUS DEFECT
// AS REASSURANCE. CAP bounds the SUM OF RULE BODIES; the emitted document is header + bodies +
// separators + notice, and it ran to 11,154 chars while this line said 10000. The quantity that
// actually bounds it is the injector's MAX_DOC clamp, so read THAT and say it in CHARACTERS —
// the harness's additionalContext ceiling is a character ceiling, not a byte one.
function liveInjectorDocMax(root = ROOT) {
  try {
    const src = readFileSync(join(root, ".claude", "hooks", "shell-trap-inject.sh"), "utf8");
    const m = /MAX_DOC\s*=\s*(\d+)/.exec(src);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function classifyTraps(total, warn = TRAPS_WARN_BYTES, block = TRAPS_BLOCK_BYTES) {
  if (total > block) return "block";
  if (total > warn) return "warn";
  return "ok";
}

function measureTraps(root = ROOT) {
  let total = 0, files = 0;
  try {
    const dir = join(root, ".claude", "traps");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      total += statSync(join(dir, f)).size;
      files++;
    }
  } catch { /* absent dir is not a failure: the plane is optional */ }
  return { total, files };
}

function render(total, rows, limits = { block: BLOCK_BYTES, warn: WARN_BYTES, ratcheted: false }) {
  // ⛔ THE CEILING COMPARISON RUNS ON `gatedTotal`, NEVER `total` (2026-08-24). Both subtotals are
  // DERIVED from the rows measure() tagged, so no call site can hand this function a plane split it
  // did not compute. A row with no plane tag (the floor-governor fixtures) counts as gated, which
  // is the fail-safe direction: an untagged byte can only ever make the gate STRICTER.
  const orchTotal = rows.reduce((s, r) => s + (r[3] === "orchestrator" ? r[1] : 0), 0);
  const sessionTotal = rows.reduce((s, r) => s + (r[3] === "session" ? r[1] : 0), 0);
  const gatedTotal = total - orchTotal - sessionTotal;
  // THE BINDING PLANE (2026-09-21). A row with no plane tag counts as gated — the
  // fail-safe direction the comment above already establishes — and a row with no scoped tag counts
  // as ALWAYS-LOADED, which is the same direction on this axis: an untagged byte can only make the
  // binding ceiling stricter, never looser.
  const scopedGatedTotal = rows.reduce(
    (sum, r) => sum + ((r[3] === "orchestrator" || r[3] === "session") ? 0 : (r[2] ? r[1] : 0)), 0);
  const alwaysGatedTotal = gatedTotal - scopedGatedTotal;
  const alwaysLevel = classify(alwaysGatedTotal, ALWAYS_WARN_BYTES, ALWAYS_BLOCK_BYTES);
  const corpusLevel = classify(gatedTotal, limits.warn, limits.block);
  // WORSE WINS. Neither plane can be relieved by the other being healthy, which is what stops the
  // `paths:`-to-buy-headroom lever from being free: scoping moves bytes from the tight budget to the
  // loose one and they still count somewhere.
  const level = worseLevel(alwaysLevel, corpusLevel);
  const suffix = limits.ratcheted ? ` · RATCHETED (hard ceiling ${kb(BLOCK_BYTES)})` : "";
  const lines = [`always-loaded band, BINDING plane (CLAUDE.md + AGENTS.md + UNSCOPED .claude/rules/**): ${kb(alwaysGatedTotal)} (${alwaysGatedTotal} B) · ceiling ${kb(ALWAYS_BLOCK_BYTES)} · warn ${kb(ALWAYS_WARN_BYTES)} — ${alwaysLevel.toUpperCase()}`,
    `  CORPUS plane (the above PLUS every \`paths:\`-scoped rules file, bounded so scoping cannot buy free headroom): ${kb(gatedTotal)} (${gatedTotal} B) · ceiling ${kb(limits.block)} · warn ${kb(limits.warn)}${suffix} — ${corpusLevel.toUpperCase()}`];
  // TOKEN ESTIMATE (2026-08-25 — measure-only, never gates). Bytes are the
  // gate's unit; the MODEL pays tokens, and case matters to the tokenizer: ALLCAPS prose measured
  // ~4.12% extra tokens at identical bytes (memory-structure panel). Divisor
  // = the measured 2.350–2.572 B/token band for this corpus (meta SKILL.md, 2026-07-31 fixtures) —
  // printed as the BAND it is. Verdict logic reads bytes only; --self-test pins that unchanged.
  lines.push(`    ~${Math.round(gatedTotal / 2.572).toLocaleString("en-US")}–${Math.round(gatedTotal / 2.35).toLocaleString("en-US")} tokens (estimate, 2.350–2.572 B/tok measured band; ALLCAPS pays ~4.12% over lowercase at equal bytes)`);
  if (orchTotal > 0) {
    const orchNames = rows.filter((r) => r[3] === "orchestrator").map((r) => r[0].replace(".claude/orchestrator/", "")).join(" · ");
    const orchCount = rows.filter((r) => r[3] === "orchestrator").length;
    lines.push(`  Band-O (.claude/orchestrator/, hook-injected per ORCHESTRATOR turn): ${kb(orchTotal)} across ${orchCount} file${orchCount === 1 ? "" : "s"} — ${orchNames}`);
    lines.push(`    MEASURED and REPORTED, never gated. Different cost curve from the line above (per-turn vs cached prefix), and sub-agents`);
    lines.push(`    never receive it — summing the two is the unit error this file exists to fix. NOT gated: no ruling covers it either way.`);
  }
  if (sessionTotal > 0) {
    const sNames = rows.filter((r) => r[3] === "session").map((r) => r[0].replace(".claude/orchestrator/", "")).join(" · ");
    const sCount = rows.filter((r) => r[3] === "session").length;
    lines.push(`  Orchestrator doctrine (.claude/orchestrator/, SessionStart-injected ONCE per session epoch, cached prefix, main session only): ${kb(sessionTotal)} across ${sCount} file${sCount === 1 ? "" : "s"} — ${sNames}`);
    lines.push(`    MEASURED and REPORTED, never gated. Same cost curve as the gated plane for the orchestrator, paid by NO sub-agent — relocated out of the gated plane 2026-09-03.`);
  }
  // The scoped subtotal is derived from rows (measure() tags each), so no call site can drift out
  // of sync with it. PRINTED, never subtracted — see isPathScoped()'s header for why.
  const scopedTotal = rows.reduce((s, r) => s + (r[2] ? r[1] : 0), 0);
  if (scopedTotal > 0) {
    const scopedNames = rows.filter((r) => r[2]).map((r) => r[0].replace(".claude/rules/", "")).join(" · ");
    lines.push(`  PATH-SCOPED (delivered only when a glob matches, NOT on every turn): ${kb(scopedTotal)} across ${rows.filter((r) => r[2]).length} files`);
    lines.push(`    ${scopedNames}`);
    // ⛔ THE FLOOR DELIBERATELY USES `total`, i.e. it INCLUDES Band-O, while the ceiling above does
    // not — and that is not an inconsistency to tidy away. The two governors ask different
    // questions: the ceiling asks "how big is the corpus a push publishes" (cached prefix, the
    // ratcheted plane), the floor asks "what does an ORCHESTRATOR turn actually pay" — and an
    // orchestrator turn pays Band-O. FLOOR_WARN_BYTES was calibrated at 395,674 B on 2026-08-18,
    // three days AFTER Band-O entered bandFiles(), so that number already contains it; excluding it
    // here would loosen the floor line by 19 KB against its own calibration.
    const floor = total - scopedTotal;
    lines.push(`  ⇒ always-loaded FLOOR (what an orchestrator turn touching none of those paths pays, Band-O included): ${kb(floor)} (${floor} B) · floor-warn ${kb(FLOOR_WARN_BYTES)}`);
    if (floor > FLOOR_WARN_BYTES) {
      lines.push(`  ⚠️  FLOOR-WARN — every-turn cost is ${kb(floor - FLOOR_WARN_BYTES)} over its line. This does NOT block (see FLOOR_WARN_BYTES).`);
      lines.push(`     Scoping a file to a \`paths:\` glob moves it off this line; trimming an always-loaded file lowers it. Adding one raises it for every seat.`);
    }
    lines.push(`    the ceiling above gates the GATED plane only — the floor line is a separate, WARN-only governor on a different set.`);
  }
  const top = rows.slice(0, 3).map(([f, b]) => `${f.replace(".claude/rules/", "")} ${kb(b)}`).join(" · ");
  if (top) lines.push(`  top: ${top}`);
  if (level === "block") {
    lines.push(`  BLOCK — the GATED band exceeds the ${kb(limits.block)} ${limits.ratcheted ? "ratcheted " : ""}ceiling by ${kb(gatedTotal - limits.block)}.`);
    lines.push(`     COMPRESS/DISPLACE before pushing (2-band split · distill · move incident-narratives to the L# body each row cites),`);
    lines.push(`     OR ratchet the ceiling DOWN with a documented cut — NEVER raise it. SKIP_BAND_BUDGET_CHECK=1 overrides.`);
    lines.push(`     fold-candidates queue: .claude/skills/meta/BAND-CANDIDATES.md — lessons whose always-loaded homes WAIT on this ceiling; fold or decline each in the same compression pass.`);
  } else if (level === "warn") {
    lines.push(`  compress-before-adding zone — a NEW always-loaded rule must DISPLACE an equal amount (the byte cost is felt here).`);
  }
  return { level, gatedTotal, alwaysGatedTotal, alwaysLevel, corpusLevel, orchTotal, text: lines.join("\n") };
}

function selfTest() {
  // instrument standard: one RED-control per detection branch + the boundary (mutation-valid — flip
  // `>` to `>=` in classify() and the boundary case goes RED).
  // Every total DERIVES from the constants. The two non-boundary cases were literals (260_000 / 235_000)
  // calibrated to the 236/233 thresholds; the 2026-07-29 raise to 330/327 turned both RED while the gate
  // itself was correct — a hardcoded fixture masquerading as a threshold test. Derive, so the next ratchet
  // (either direction) cannot produce a false RED. The boundary pair was already derived and stayed green.
  const cases = [
    ["over-block", BLOCK_BYTES + 1_000, "block"],
    ["in-warn zone", WARN_BYTES + 1_000, "warn"],
    ["under-warn (clean)", Math.floor(WARN_BYTES / 2), "ok"],
    ["exact-ceiling boundary (== block is NOT over)", BLOCK_BYTES, "warn"],
    ["exact-warn boundary (== warn is NOT over)", WARN_BYTES, "ok"],
  ];
  let fail = 0;
  console.log("=== check-band-budget --self-test (instrument standard) ===");
  for (const [label, total, expect] of cases) {
    const got = classify(total);
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: total=${total} -> ${got} (expect ${expect})`);
  }

  // DELTA-GATING branch (2026-07-31). Both arms — the does-NOT-block arm is the whole
  // point of the change and is exactly the one a one-sided oracle would skip. Mutation-valid:
  // delete the `delta > 0` condition in gateDecision() and the "shrinking" case goes RED.
  const gateCases = [
    ["over ceiling + push GROWS   -> BLOCK",  "block", +1_000, true],
    ["over ceiling + push SHRINKS -> ALLOW",  "block", -1_000, false],  // ← the deferred fix, live
    ["over ceiling + push NEUTRAL -> ALLOW",  "block",      0, false],
    ["over ceiling + baseline unresolved -> BLOCK (fail-safe, never fail-open)", "block", null, true],
    ["warn level + growing  -> ALLOW (delta only gates the block level)", "warn", +9_999, false],
    ["ok level  + growing   -> ALLOW",        "ok",    +9_999, false],
  ];
  for (const [label, level, delta, expectBlock] of gateCases) {
    const got = gateDecision(level, delta).block;
    const ok = got === expectBlock;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: -> block=${got} (expect ${expectBlock})`);
  }

  // DELIVERED-PLANE branch (L3, 2026-08-18). One RED control per claim the report makes. The
  // grouping arm is the load-bearing one: records ARE NOT events, and counting records would have
  // overstated event volume ~10x on the live log (320 records / 33 events) — an error that inflates
  // the exact number the L2 decision will be read against.
  // Mutation-valid: drop the `(session_id, prompt_id)` key down to `session_id` alone and the
  // "two prompts in one session" arm goes RED; make the missing-path branch return 0 instead of
  // null and the `unsizable` arm goes RED.
  // ⚠️ `n` at the bottom is HAND-SUMMED from each case-list's .length, so an arm block that is
  // block-scoped (or a maintainer who forgets the addend) reports its passes as if they never ran —
  // this block tripped exactly that on arrival: 10 arms executed and printed while the summary still
  // read 47. `fail` is incremented correctly either way, so the verdict cannot go false-GREEN; only
  // the count understates. Declared out here so it reaches the tally.
  let deliveredArms = 0;
  {
    const dlog = (recs) => {
      const p = join(mkdtempSync(join(tmpdir(), "band-delivered-")), "log.jsonl");
      writeFileSync(p, recs.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
      return p;
    };
    const sizes = { "a.md": 100, "b.md": 250 };
    const sizeOf = (p) => (p in sizes ? sizes[p] : null);
    const rec = (sid, pid, fp, reason) => ({ session_id: sid, prompt_id: pid, file_path: fp, load_reason: reason });

    const dCases = [
      ["absent log -> null (fresh clone must not crash the gate)",
        () => deliveredPlane(join(tmpdir(), "band-delivered-nope-" + Date.now(), "x.jsonl"), sizeOf),
        (d) => d === null],
      ["empty log -> null",
        () => deliveredPlane(dlog([]), sizeOf), (d) => d === null],
      ["two records, ONE prompt -> 1 event summing both files (records != events)",
        () => deliveredPlane(dlog([rec("s1", "p1", "a.md", "compact"), rec("s1", "p1", "b.md", "compact")]), sizeOf),
        (d) => d.events === 1 && d.median === 350],
      ["two prompts in one session -> 2 events (the ~10x-overstatement guard)",
        () => deliveredPlane(dlog([rec("s1", "p1", "a.md", "compact"), rec("s1", "p2", "b.md", "compact")]), sizeOf),
        (d) => d.events === 2],
      ["duplicate path within an event counted ONCE",
        () => deliveredPlane(dlog([rec("s1", "p1", "a.md", "compact"), rec("s1", "p1", "a.md", "compact")]), sizeOf),
        (d) => d.events === 1 && d.median === 100],
      ["deleted path -> counted as unsizable, NOT silently 0 (a deletion must not read as a saving)",
        () => deliveredPlane(dlog([rec("s1", "p1", "a.md", "compact"), rec("s1", "p1", "gone.md", "compact")]), sizeOf),
        (d) => d.unsizable === 1 && d.median === 100],
      ["malformed line skipped and COUNTED, does not throw",
        () => deliveredPlane(dlog(["{not json", rec("s1", "p1", "a.md", "compact")]), sizeOf),
        (d) => d.malformed === 1 && d.events === 1],
      ["record with no file_path is malformed, not an event",
        () => deliveredPlane(dlog([{ session_id: "s1", prompt_id: "p1" }]), sizeOf),
        (d) => d === null],
      ["compact wins attribution when an event carries several reasons",
        () => deliveredPlane(dlog([rec("s1", "p1", "a.md", "path_glob_match"), rec("s1", "p1", "b.md", "compact")]), sizeOf),
        (d) => d.byReason.length === 1 && d.byReason[0][0] === "compact"],
      ["renderDelivered(null) emits nothing (absent log prints no block)",
        () => renderDelivered(null, 1), (v) => Array.isArray(v) && v.length === 0],
    ];
    for (const [label, run, check] of dCases) {
      let ok = false, note = "";
      try { const v = run(); ok = check(v); if (!ok) note = ` got=${JSON.stringify(v)?.slice(0, 120)}`; }
      catch (e) { ok = false; note = ` threw: ${e.message}`; }
      if (!ok) fail++;
      console.log(`  [${ok ? "PASS" : "FAIL"}] delivered: ${label}${note}`);
    }
    deliveredArms = dCases.length;
  }

  // RATCHET branch (2026-08-13, one-way by design). Arms cover the three properties the design
  // names: the ceiling FOLLOWS a cut down, it NEVER follows growth up, and a missing/garbage state
  // file cannot weaken the gate. MUTATION TABLE — MEASURED 2026-08-13, not hand-written; re-measure
  // it in the same commit as any arm change rather than editing it (a table that promises fewer
  // failures than it delivers invites the next maintainer to "fix" a live arm):
  //   `Math.min` -> `Math.max` in effectiveLimits() => exactly 3 RED, and only these 3 —
  //   "after a 100 KB cut" (825000, expected 725000) · "growth cannot RAISE it" (984563 — the mutant
  //   raises the ceiling ABOVE the hard limit, which is the failure the clamp prevents) ·
  //   "zero margin" (825000, expected 700000). Every non-clamp arm stays green.
  const ratchetCases = [
    ["no state file          -> hard ceiling, unratcheted", null, BLOCK_BYTES, false],
    ["at adoption (min+margin == BLOCK) -> no-op, hard ceiling",
      { observedMin: 740_437, marginBytes: 84_563 }, BLOCK_BYTES, false],
    ["after a 100 KB cut     -> ceiling FOLLOWS DOWN by exactly the cut",
      { observedMin: 640_437, marginBytes: 84_563 }, 725_000, true],
    ["growth cannot RAISE it -> min+margin above BLOCK is clamped to BLOCK",
      { observedMin: 900_000, marginBytes: 84_563 }, BLOCK_BYTES, false],
    ["zero margin            -> ceiling pinned exactly at the observed minimum",
      { observedMin: 700_000, marginBytes: 0 }, 700_000, true],
  ];
  for (const [label, state, expectBlock, expectRatcheted] of ratchetCases) {
    const got = effectiveLimits(state);
    const ok = got.block === expectBlock && got.ratcheted === expectRatcheted;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: -> ceiling=${got.block} ratcheted=${got.ratcheted} (expect ${expectBlock}/${expectRatcheted})`);
  }
  // The warn standoff must survive a ratchet, or a ratcheted gate would block with no warn zone.
  {
    const got = effectiveLimits({ observedMin: 640_437, marginBytes: 84_563 });
    const ok = got.block - got.warn === BLOCK_BYTES - WARN_BYTES;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ratcheted warn standoff preserved: ${got.block - got.warn} B (expect ${BLOCK_BYTES - WARN_BYTES})`);
  }
  // DIRECTION — the whole design. A proposal exists only for a LOWER published band, never a higher
  // one, and an implausible collapse is refused rather than locked in.
  const dirCases = [
    ["a LOWER band proposes a down-move",        { observedMin: 740_437, marginBytes: 84_563 }, 700_000, "available"],
    ["an EQUAL band proposes nothing",           { observedMin: 740_437, marginBytes: 84_563 }, 740_437, "none"],
    ["a HIGHER band proposes nothing (never up)",{ observedMin: 740_437, marginBytes: 84_563 }, 800_000, "none"],
    ["an implausible collapse is REFUSED",       { observedMin: 740_437, marginBytes: 84_563 }, 100_000, "implausible"],
    ["an unmeasurable HEAD writes nothing",      { observedMin: 740_437, marginBytes: 84_563 }, null,    "no-measurement"],
  ];
  for (const [label, state, headTotal, expect] of dirCases) {
    const got = ratchetProposal(state, headTotal).kind;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: -> ${got} (expect ${expect})`);
  }

  // GATE-LEVEL PLANE (panel, 2026-08-13): reverting computeGateLevel to bare `level` — the exact
  // documented fail-open — used to leave this suite fully GREEN. Three arms pin the plane.
  const glCases = [
    // ⚠️ THIS ARM IS NOT A FAIL-SAFE AND MUST NOT BE READ AS ONE (2026-09-13). It records
    // that the band delta PASSES THE WORKTREE LEVEL THROUGH on an unresolvable HEAD — which at warn
    // tier means ALLOW. Paired with the per-file gate's old `block: false`, the two composed into a
    // fail-open while each read as a safety property. The per-file gate now refuses on its own.
    ["HEAD unresolvable -> worktree level passes through (ALLOW at warn — not a fail-safe)", "warn", null, { block: 100 }, "warn"],
    ["HEAD over ceiling -> block, whatever the worktree says", "ok", 150, { block: 100 }, "block"],
    ["HEAD under ceiling -> ok even when the worktree is over (dirty-grow reads HEAD)", "block", 50, { block: 100 }, "ok"],
  ];
  for (const [label, level, headTotal, limits, expect] of glCases) {
    const got = computeGateLevel(level, headTotal, limits);
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}: -> ${got} (expect ${expect})`);
  }

  // RATCHET PARSER: the CORRUPT sentinel must be reachable — a present-but-garbage
  // state file is NOT "no state file", it is a refusal.
  const prCases = [
    ["garbage text -> CORRUPT", "not json {", "CORRUPT"],
    ["parseable but mis-shaped -> CORRUPT", '{"observedMin":"x","marginBytes":5}', "CORRUPT"],
    ["valid state -> parsed", '{"observedMin":700000,"marginBytes":1000}', "ok"],
  ];
  for (const [label, text, expect] of prCases) {
    const r = parseRatchet(text);
    const got = r === "CORRUPT" ? "CORRUPT" : "ok";
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] parseRatchet: ${label} -> ${got}`);
  }

  // UP-MOVE RITUAL (2026-09-21). The LIVE file is the first arm and it is the one
  // that matters: if the shipped state ever stops satisfying its own governance rule, this reds.
  const Q = "owner verbatim: 'example approval text for the fixture'";
  const govCases = [
    ["LIVE file passes its own ritual", JSON.parse(readFileSync(RATCHET_FILE, "utf8")), 0],
    ["a recorded raise QUOTING the owner is allowed",
      { observedMin: 200, history: [{ observedMin: 100 }, { observedMin: 200, note: Q }] }, 0],
    ["a recorded raise with NO quote is REFUSED",
      { observedMin: 200, history: [{ observedMin: 100 }, { observedMin: 200, note: "re-baseline" }] }, 1],
    ["a raise whose `owner verbatim:` marker carries no quotation is REFUSED",
      { observedMin: 200, history: [{ observedMin: 100 }, { observedMin: 200, note: "owner verbatim:" }] }, 1],
    ["a hand-raised observedMin with NO history entry is REFUSED",
      { observedMin: 999, history: [{ observedMin: 100 }] }, 1],
    ["an ordinary DOWN-move needs no quote",
      { observedMin: 50, history: [{ observedMin: 100 }, { observedMin: 50, note: "ratcheted down" }] }, 0],
  ];
  for (const [label, raw, expect] of govCases) {
    const got = ratchetGovernance(raw).length;
    const ok = (expect === 0) === (got === 0);
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] up-move ritual: ${label} -> ${got} problem(s)`);
  }

  // PER-FILE classifier (panel: the only guard on the 150k harness limit had ZERO arms —
  // effectively deletable while the suite stayed green).
  const pfCases = [
    ["over the harness limit -> block", PER_FILE_BLOCK_CHARS + 1, "block"],
    ["between warn and limit -> warn", PER_FILE_WARN_CHARS + 1, "warn"],
    ["under warn -> ok", PER_FILE_WARN_CHARS - 1, "ok"],
  ];
  for (const [label, chars, expect] of pfCases) {
    const got = classifyPerFile(chars);
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] classifyPerFile: ${label} -> ${got}`);
  }

  // PER-FILE DELTA gate. The per-file arm is DORMANT on the real tree (largest gated file 137,212 B
  // against a 140,000-char warn), so these arms are the ONLY thing that can reach its branches — a
  // live run exercises none of them. Every case names its own baseline, so no arm reads its oracle
  // off the thing under test.
  const OVER = PER_FILE_BLOCK_CHARS + 1_000;   // comfortably over the harness limit
  const WAY_OVER = PER_FILE_BLOCK_CHARS + 9_000;
  const UNDER_WARN = PER_FILE_WARN_CHARS - 1;
  const BETWEEN = PER_FILE_WARN_CHARS + 1;     // over warn, under block
  const F = ".claude/rules/x.md", G = ".claude/rules/y.md";
  const pfGateCases = [
    // label                                         head                  base                  expect
    ["over the limit AND grew -> BLOCK",             [[F, WAY_OVER]],      [[F, OVER]],          true],
    ["over the limit but SHRANK -> ALLOW (a cut can land)", [[F, OVER]],   [[F, WAY_OVER]],      false],
    ["over the limit, UNCHANGED -> ALLOW (a peer who never opened it)", [[F, OVER]], [[F, OVER]], false],
    ["new file, absent at baseline -> BLOCK",        [[F, OVER]],          [],                   true],
    ["crossed up from under-warn -> BLOCK",          [[F, OVER]],          [[G, BETWEEN]],       true],
    ["baseline unresolved -> fail-safe BLOCK",       [[F, OVER]],          null,                 true],
    // ⛔ EXPECTATION FLIPPED 2026-09-13. This arm asserted ALLOW and named
    // the band delta as the owner of the fail-safe — encoding the false premise instead of catching
    // it. The band delta allows at warn tier and the ratchet guarantees the baseline passes, so the
    // deferee is never in the blocking state. A gate that cannot resolve HEAD cannot size any file.
    ["HEAD unresolvable -> fail-safe BLOCK (no deferral: the band delta allows at warn tier)", null, [[F, OVER]], true],
    ["no file over the limit -> ALLOW",              [[F, BETWEEN]],       [[F, UNDER_WARN]],    false],
    ["one shrinks, one grows -> BLOCK",              [[F, OVER], [G, WAY_OVER]], [[F, WAY_OVER], [G, OVER]], true],
  ];
  for (const [label, head, base, expect] of pfGateCases) {
    const got = perFileGateDecision(head, base).block;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] perFileGateDecision: ${label} -> ${got ? "BLOCK" : "ALLOW"}`);
  }

  // POSITIVE CONTROL on the arms above: perFileGateDecision must be the ONLY thing deciding the
  // per-file exit. If a future edit re-introduces a HEAD-only flag, the shrink case flips to BLOCK
  // and arm 2 REDs — that arm is the mutation detector for this whole fix.
  {
    const shrinkAllowed = perFileGateDecision([[F, OVER]], [[F, WAY_OVER]]).block === false;
    const growBlocked   = perFileGateDecision([[F, WAY_OVER]], [[F, OVER]]).block === true;
    const ok = shrinkAllowed && growBlocked;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] perFileGateDecision DISCRIMINATES: shrink allowed AND growth blocked (both, not either)`);
  }

  // PER-FILE SCOPE. These arms exist because the first widening was WRONG in a way only a live run
  // showed: it pulled in 59 files, 56 of them MEMORY/CHANGELOG archive shards that memory-tier-split
  // caps at ~200 KB deliberately and that are read by anchor, never whole. Arm 3 is the one that
  // pins the exclusion; without it a future widening silently re-reports a design as a violation.
  const enfCases = [
    ["a gated rules file -> block tier",            ".claude/rules/bash-environment.md",                          "block"],
    ["CLAUDE.md -> block tier",                     "CLAUDE.md",                                                  "block"],
    ["a SKILL.md -> warn tier (delivered whole)",   ".claude/skills/wrap/SKILL.md",                                "warn"],
    ["an orchestrator file -> warn tier",           ".claude/orchestrator/conventions.md",                         "warn"],
    ["a MEMORY archive shard -> NOT watched",       ".claude/skills/meta/MEMORY-ARCHIVE-2026-08-30-2026-09-02.md", null],
    ["a CHANGELOG archive shard -> NOT watched",    ".claude/skills/meta/CHANGELOG-ARCHIVE-2026-04-19-2026-05-27.md", null],
    ["a references/ file -> NOT watched (anchored)", ".claude/skills/wrap/references/measurement-registry.md",     null],
    ["a skill CHANGELOG -> NOT watched",            ".claude/skills/wrap/CHANGELOG.md",                            null],
    ["an unrelated path -> NOT watched",            "src/types/index.ts",                                         null],
  ];
  for (const [label, rel, expect] of enfCases) {
    const got = perFileEnforcement(rel);
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] perFileEnforcement: ${label} -> ${String(got)}`);
  }

  // TIER vs DECISION: a warn-tier file that grows past the limit must NOT refuse the push, and a
  // block-tier file in the identical state must. Both in one arm so neither can pass alone.
  {
    const W = ".claude/skills/wrap/SKILL.md", R = ".claude/rules/bash-environment.md";
    const warnGrew  = perFileGateDecision([[W, PER_FILE_BLOCK_CHARS + 9_000, "warn"]],  [[W, PER_FILE_BLOCK_CHARS + 1_000, "warn"]]).block;
    const blockGrew = perFileGateDecision([[R, PER_FILE_BLOCK_CHARS + 9_000, "block"]], [[R, PER_FILE_BLOCK_CHARS + 1_000, "block"]]).block;
    const ok = warnGrew === false && blockGrew === true;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] tier gates the refusal: warn-tier growth ALLOWS, block-tier growth BLOCKS`);
  }

  // MEASURED-SET COVERAGE (2026-08-15). Band-O sat OUTSIDE bandFiles() for ~5 weeks — including
  // through a 2026-08-13 panel that edited this very function — so ~18.7 KB of always-loaded bytes
  // were paid on every orchestrator turn and counted by nothing. The failure mode is silence: the
  // gate reports a clean, plausible total over an incomplete set, which is exactly the shape no
  // total can reveal. These arms pin the SET, not the number.
  //
  // Each arm is independently mutation-valid: delete the orchestrator block in bandFiles() and arm 1
  // REDs; delete the rules walk and arm 2 REDs. Arm 2 is the POSITIVE CONTROL — without it, a
  // bandFiles() that returned every .md in the repo would satisfy arm 1 while measuring nonsense.
  const measured = bandFiles();
  const setCases = [
    [".claude/orchestrator/*.md is measured", measured.some((f) => f.includes("/.claude/orchestrator/"))],
    ["positive control: .claude/rules/*.md still measured", measured.some((f) => f.includes("/.claude/rules/"))],
    ["positive control: CLAUDE.md still measured", measured.some((f) => f.endsWith("/CLAUDE.md"))],
    // NEGATIVE control (folded 2026-08-15). The three arms above are all
    // EXISTENTIAL, so they rule out an over-NARROW bandFiles() and are structurally blind to an
    // over-BROAD one — the direction that silently INFLATES the band. The rules archive (the
    // non-loaded directory under `.claude/docs/` that displaced rule narratives move to) is the right negative referent
    // rather than an invented fixture: its 4 files (237,394 B)
    // exist BECAUSE they were displaced OUT of always-loaded rules files to stop paying for them,
    // so being unmeasured is their entire purpose (bash-environment.md points at them 5×).
    // Blast radius, and the REALISTIC case is the wider one
    // (re-derived here): a widening that re-swallows that archive alone is 730.8 -> 968.2 KB
    // (143.2 KB past the HARD ceiling), but the glob anyone would actually write —
    // `.claude/**/*.md` — pulls all 64 files under `.claude/docs/` and lands at 2,499,307 B
    // = 2499.3 KB, 3.4x the entire current band and 1674.3 KB past hard. Both are caught by
    // this one arm. Neither of the two reviewers had the larger figure until it was measured.
    ["negative control: .claude/docs/ is NOT measured", !measured.some((f) => f.includes("/.claude/docs/"))],
  ];
  for (const [label, got] of setCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] measured-set: ${label}`);
  }

  // ── PLANE PARTITION (2026-08-24) ────────────────────────────────────────────────────────────
  // The defect these arms exist for survived NINE DAYS because nothing compared the two readers:
  // bandFiles() (worktree, both planes) grew a directory that baselineTotal()'s pathspec never
  // gained, and render() then classified the WIDER number against a ceiling derived from the
  // NARROWER one — 19,345 B of phantom overage, 65% of the reported breach. The measured-set arms
  // above pin WHICH FILES are measured; these pin WHICH PLANE PAYS FOR THEM, which is the question
  // nobody was asking. Every arm is mutation-valid and the mutation is named on the arm.
  const relOf = (f) => f.replace(ROOT + "/", "");
  const planeCases = [
    // (a) the classifier itself. Mutation: delete a branch of classifyBandPath() -> the row REDs.
    ["CLAUDE.md -> gated", classifyBandPath("CLAUDE.md") === "gated"],
    ["AGENTS.md -> gated", classifyBandPath("AGENTS.md") === "gated"],
    [".claude/rules/x.md -> gated", classifyBandPath(".claude/rules/x.md") === "gated"],
    [".claude/rules/sub/y.md -> gated (subdir-tolerant)", classifyBandPath(".claude/rules/sub/y.md") === "gated"],
    [".claude/orchestrator/*.md -> orchestrator, NOT gated",
      classifyBandPath(".claude/orchestrator/active-recall-orchestrator.md") === "orchestrator"],
    [".claude/orchestrator/<doctrine>.md -> session (SessionStart-injected once per epoch), NOT orchestrator, NOT gated",
      classifyBandPath(".claude/orchestrator/conventions.md") === "session" && classifyBandPath(".claude/orchestrator/commit-doctrine.md") === "session"],
    // NEGATIVE control: an unplaced always-loaded-looking path must NOT silently become gated.
    // This is the 2026-08-15 shape reduced to a fixture — a new band dir nobody classified.
    ["an unplaced .claude/ dir -> unclassified, never a silent gated byte",
      classifyBandPath(".claude/newband/z.md") === "unclassified"],
    [".claude/docs/ -> unclassified (displaced archive, on neither plane)",
      classifyBandPath(".claude/docs/rules-ARCHIVE/i18n-cases.md") === "unclassified"],

    // (b) ⛔ THE ARM THAT WOULD HAVE CAUGHT IT — the two readers must agree on the SAME SET, live.
    // Direction 1: nothing bandFiles() measures may be unplaced. Mutation: add a dir to bandFiles()
    // without touching classifyBandPath() -> RED. (Set-based, not total-based, so a dirty worktree
    // cannot make it flap.)
    ["live: every measured band file has a decided plane (zero unclassified)",
      measured.every((f) => classifyBandPath(relOf(f)) !== "unclassified")],
    // Direction 2: every GATED file must be REACHABLE BY GATED_PATHSPEC — the exact property that
    // failed (orchestrator bytes were in the gated total, reachable by no pathspec entry).
    // Mutation: add ".claude/orchestrator/" to classifyBandPath()'s gated branch -> RED.
    ["live: every GATED file is covered by GATED_PATHSPEC (ls-tree can see it)",
      measured.filter((f) => classifyBandPath(relOf(f)) === "gated").every((f) => coveredByGatedPathspec(relOf(f)))],
    // Direction 3: the converse — nothing OUTSIDE the pathspec may be gated, and nothing INSIDE it
    // may be non-gated. Mutation: drop ".claude/rules/" from GATED_PATHSPEC -> RED (the rules files
    // classify gated but stop being covered), which is the silent-undercount direction.
    ["live: nothing outside GATED_PATHSPEC is gated, nothing inside it is not",
      measured.every((f) => coveredByGatedPathspec(relOf(f)) === (classifyBandPath(relOf(f)) === "gated"))],
    // Positive control for the two arms above: they are universally-quantified over `measured`, so
    // an EMPTY or all-orchestrator set would satisfy them vacuously (a control that could not
    // have come out the other way proves nothing).
    ["positive control: the live gated set is non-empty",
      measured.filter((f) => classifyBandPath(relOf(f)) === "gated").length > 0],
    ["positive control: the live orchestrator set is non-empty",
      measured.filter((f) => classifyBandPath(relOf(f)) === "orchestrator").length > 0],
  ];
  for (const [label, got] of planeCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] plane: ${label}`);
  }

  // (c) ⛔ THE REGRESSION ARM, IN THE UNIT THE DEFECT WAS EXPRESSED IN. render() must compare the
  // GATED subtotal to the ceiling. Fixture: gated sits UNDER the ceiling, Band-O pushes the naive
  // total OVER it — the live 2026-08-24 shape (614,041 gated / 633,386 total / 603,617 ceiling),
  // scaled. Mutation: revert render() to `classify(total, ...)` and arm 1 REDs with a phantom
  // BLOCK. Arm 2 is the other direction and is the SAFETY property this whole change must not
  // break: a genuinely over-ceiling gated plane still blocks, whatever Band-O does.
  const planeLimits = { block: 1_000, warn: 900, ratcheted: false };
  const rowsWithOrch = (gatedB, orchB) => [
    [".claude/rules/a.md", gatedB, false, "gated"],
    [".claude/orchestrator/active-recall-orchestrator.md", orchB, false, "orchestrator"],
  ];
  const rUnderPlusOrch = render(900 + 200, rowsWithOrch(900, 200), planeLimits);   // gated 900 <= 1000
  const rOverGated = render(1_100 + 200, rowsWithOrch(1_100, 200), planeLimits);   // gated 1100 > 1000
  const rNoOrch = render(1_100, [[".claude/rules/a.md", 1_100, false, "gated"]], planeLimits);
  const renderCases = [
    ["⛔ Band-O alone CANNOT push the gate to block (the phantom breach)", rUnderPlusOrch.level !== "block"],
    ["⛔ SAFETY: a genuinely over-ceiling GATED plane still blocks", rOverGated.level === "block"],
    ["the breach FIGURE is gated-vs-ceiling, not total-vs-ceiling", rOverGated.text.includes("by 0.1 KB")],
    ["gated-only tree behaves identically (no Band-O row -> same verdict)", rNoOrch.level === "block"],
    ["Band-O is REPORTED on its own line when present", rUnderPlusOrch.text.includes("Band-O")],
    ["Band-O line is absent when there is no orchestrator row", !rNoOrch.text.includes("Band-O")],
    ["render exposes the gated subtotal to callers", rUnderPlusOrch.gatedTotal === 900],
    // A row with no plane tag counts as GATED — the fail-safe direction (an untagged byte can only
    // tighten the gate, never loosen it). Pins the floor-governor fixtures' contract too.
    ["an untagged row counts as GATED (fail-safe for old/foreign fixtures)",
      render(1_100, [["x.md", 1_100, false]], planeLimits).level === "block"],
  ];
  for (const [label, got] of renderCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] plane-render: ${label}`);
  }

  // isPathScoped: one arm per claim class, each with a DISCRIMINATING fixture — a control that
  // could not have come out the other way proves nothing. Fixtures are written to a temp
  // dir and removed, so this never touches .claude/rules/ (writing a probe file there is exactly
  // what the always-loaded write guard refuses, and correctly).
  //
  // ⛔ CLASS 4 IS THE ONE THAT MATTERS AND IT IS LIVE TODAY: `tests-unit.md` and `CLAUDE.md` both
  // now discuss `paths:` frontmatter at length IN PROSE. A predicate that greps for the token
  // instead of parsing position would score CLAUDE.md as path-scoped and silently drop 11.6 KB
  // from the always-loaded floor. Use-vs-mention, in the file that documents the mechanism.
  const scopeFixtures = [
    ["scoped: paths: in frontmatter at byte 0", '---\npaths: ["tests/**"]\n---\n\n# X\n', true],
    ["unscoped: no frontmatter at all", "# X\n\nsome rules prose\n", false],
    ["unscoped: frontmatter WITHOUT a paths key", "---\nmodified: 2026-08-18\n---\n\n# X\n", false],
    ["MENTION not USE: `paths:` in prose, no frontmatter", '# X\n\nAdd `paths: ["tests/**"]` frontmatter to scope a rule.\n', false],
    ["MENTION not USE: prose paths: AFTER a closed non-paths frontmatter", "---\nmodified: 2026-08-18\n---\n\nWrite paths: to scope it.\n", false],
    ["unscoped: unclosed frontmatter block", '---\npaths: ["tests/**"]\n\n# X\n', false],
  ];
  const scopeDir = mkdtempSync(join(tmpdir(), "band-scope-"));
  const scopeCases = [];
  for (const [label, body, want] of scopeFixtures) {
    const p = join(scopeDir, `${scopeCases.length}.md`);
    writeFileSync(p, body);
    scopeCases.push([label, isPathScoped(p) === want]);
  }
  // Positive control on the REAL corpus, both directions — a fixture-only suite can pass while the
  // predicate is wrong about the files it actually runs on.
  scopeCases.push(["live: tests-unit.md IS detected as scoped", isPathScoped(join(ROOT, ".claude/rules/tests-unit.md"))]);
  // ⛔ THE LIVE NEGATIVE CONTROL IS `security.md`, NOT `CLAUDE.md`, AND THE DIFFERENCE WAS MEASURED.
  // CLAUDE.md was the obvious pick and it is VACUOUS: it holds no literal `paths:` token, so it
  // reads NOT-SCOPED under the strict predicate AND under a naive `includes("paths:")` grep — the
  // control passes whatever the truth is. `security.md` DOES carry `paths:` in prose (image paths,
  // redirect paths), so it separates the two implementations: mutation-measured, the naive grep
  // scores it scoped and silently drops 24,958 B from the always-loaded floor (160.6/403.1 KB vs
  // the correct 135.7/428.0) — on the one file that must NEVER be scoped.
  // security.md is not in this copy: isPathScoped returns false on a missing file, so this arm passes
  // vacuously here and still counts toward the total.
  scopeCases.push(["live: security.md is NOT scoped despite carrying `paths:` in prose", !isPathScoped(join(ROOT, ".claude/rules/security.md"))]);
  rmSync(scopeDir, { recursive: true, force: true });
  for (const [label, got] of scopeCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] isPathScoped: ${label}`);
  }

  // FLOOR governor. Arm 3 is the load-bearing one and the reason this block exists: the floor is
  // WARN-ONLY, so a mutation that lets it influence `level` must RED here. Without it, a future
  // "tidy" could fold the floor into classify() and silently convert a fleet-wide push gate onto
  // a number that DROPS when a file is scoped — the exact loosening this design refuses.
  const floorLimits = { block: BLOCK_BYTES, warn: WARN_BYTES, ratcheted: false };
  // ⛔ THE FIXTURE CARRIES A SESSION-PLANE ROW, AND IT IS LOAD-BEARING (2026-09-21). The floor is
  // `total - scopedTotal`, so it INCLUDES the orchestrator/session planes; the BINDING ceiling
  // excludes them. Piling every floor byte into one gated rules row — which is what this fixture did
  // until the binding ceiling landed — models a repo where the whole every-turn cost is rules files,
  // and then a floor breach is necessarily a binding breach too, so the arm cannot isolate what it
  // claims to test. Today's real split is 218 KB of rules against 193 KB of orchestrator doctrine,
  // and this fixture now mirrors that: the floor breaches while BOTH ceilings stay healthy.
  const mkRows = (alwaysB, scopedB, sessionB) => [
    ["a/always.md", alwaysB, false],
    ["a/scoped.md", scopedB, true],
    [".claude/orchestrator/session-doctrine.md", sessionB, false, "session"],
  ];
  // under the floor line, and far under both ceilings => no floor warning, level ok
  const rUnder = render(150_000 + 50_000 + 150_000, mkRows(150_000, 50_000, 150_000), floorLimits);
  // over the floor line, still under both ceilings => floor warning present, level STILL ok
  const rOver = render(200_000 + 50_000 + 210_000, mkRows(200_000, 50_000, 210_000), floorLimits);
  const floorCases = [
    ["floor under its line → no FLOOR-WARN emitted", !rUnder.text.includes("FLOOR-WARN")],
    ["floor over its line → FLOOR-WARN emitted", rOver.text.includes("FLOOR-WARN")],
    ["⛔ floor breach does NOT change the gate level (WARN-only)", rOver.level === "ok"],
    ["floor line always reports the number, breach or not", rUnder.text.includes("always-loaded FLOOR")],
    // ── BINDING PLANE (2026-09-21 narrowing) ───────────────────────────────────────────────────
    // Arm 1 is the whole point of the change: scoped bytes must NOT reach the binding ceiling.
    // Mutation: drop the `r[2] ?` term from scopedGatedTotal and this REDs.
    ["binding plane EXCLUDES path-scoped bytes", rOver.alwaysGatedTotal === 200_000],
    // Mutation: change worseLevel to always return the corpus level and this REDs.
    ["binding breach BLOCKS even while the corpus plane is healthy",
      render(300_000, [["a/always.md", 300_000, false]], floorLimits).level === "block"],
    // Mutation: subtract scoped bytes from the CORPUS total too, and this REDs — which is what
    // stops `paths:`-scoping from buying headroom on every budget at once.
    ["scoping moves bytes to the corpus plane, it does not delete them",
      render(300_000, [["a/scoped.md", 300_000, true]], floorLimits).gatedTotal === 300_000],
    // ... and the same fixture must be OK on the binding plane, or the arm above proves nothing.
    ["a fully-scoped corpus reads OK on the binding plane",
      render(300_000, [["a/scoped.md", 300_000, true]], floorLimits).alwaysLevel === "ok"],
    // The two readers must share ONE scoped predicate (the file's own SSOT discipline).
    ["worktree and ref readers share one scoped predicate",
      isPathScopedText('---\npaths: ["tests/**"]\n---\n') === true &&
      isPathScopedText("---\nmodified: 2026-09-21\n---\n") === false],
  ];
  for (const [label, got] of floorCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] floor-governor: ${label}`);
  }

  // ── TRAPS PLANE (2026-09-21) ────────────────────────────────────────────────
  // The traps block was the only block-mode branch added to this file this year and NO arm could
  // reach it: `selfTest()` ends ~70 lines above where that block used to sit, so "109/109" was true
  // and structurally incapable of touching it. Two lenses found the same shape in two different
  // files in one commit. The fix that makes these arms possible is extracting `classifyTraps` /
  // `measureTraps` / `liveInjectorCap` to module scope — an inline copy would grade code nobody runs.
  const trapsCases = [
    // BOUNDARIES are the whole point: both comparisons are strict `>`, so a total sitting EXACTLY on
    // a threshold is under it. Flipping either `>` to `>=` REDs arms 2 and 4 and nothing else.
    ["far below warn reads ok", classifyTraps(1_000, 150_000, 160_000) === "ok"],
    ["exactly ON warn is still ok (strict >)", classifyTraps(150_000, 150_000, 160_000) === "ok"],
    ["one byte over warn reads warn", classifyTraps(150_001, 150_000, 160_000) === "warn"],
    ["exactly ON block is still warn (strict >)", classifyTraps(160_000, 150_000, 160_000) === "warn"],
    ["one byte over block reads block", classifyTraps(160_001, 150_000, 160_000) === "block"],
    // Reachability, not shape: the live plane must actually be measurable from here, or every arm
    // above grades arithmetic over a population the gate can never read (the TENTH vacuous-control
    // way — the fixture you reason about is not the fixture the code opens).
    ["the live traps plane is measurable", (() => { const m = measureTraps(); return m.files > 0 && m.total > 0; })()],
    ["a missing traps dir is OK, not a crash", (() => { const m = measureTraps(mkdtempSync(join(tmpdir(), "bb-notraps-"))); return m.files === 0 && m.total === 0; })()],
    // The CAP must come from the injector's source, never from a number typed here.
    ["liveInjectorCap reads the hook's real CAP", Number.isInteger(liveInjectorCap()) && liveInjectorCap() > 0],
    ["liveInjectorCap fails to null, never to a remembered number",
      liveInjectorCap(mkdtempSync(join(tmpdir(), "bb-nohook-"))) === null],
    // The docMax reader gets the SAME two arms, because it is the one the render line now leans on:
    // an unread clamp silently reverts this file to printing a number that is not the payload bound.
    ["liveInjectorDocMax reads the hook's real document clamp",
      Number.isInteger(liveInjectorDocMax()) && liveInjectorDocMax() > 0],
    ["liveInjectorDocMax fails to null, never to a remembered number",
      liveInjectorDocMax(mkdtempSync(join(tmpdir(), "bb-nodoc-"))) === null],
    // And the ORDERING is the invariant that makes the pair coherent: the clamp must sit above the
    // body budget, or the clamp is dead code and CAP is the real bound after all.
    ["the document clamp is above the body CAP", liveInjectorDocMax() > liveInjectorCap()],
    // ⛔ REGRESSION GUARD for the restated-cap defect itself. The defect was a comment restating the injector's
    // per-command cap as a parenthesised literal while the live value had moved on — a second copy
    // of a constant this file does not own. ⚠️ THIS COMMENT DESCRIBES THAT FORM AND MUST NEVER RENDER
    // IT: the first version of this arm quoted the offending text verbatim and the arm went RED on
    // its own comment, first run. That is the corpus's own use-vs-mention rule ("in an instrument's
    // docs, DESCRIBE a matched form, never render it") arriving as a live RED rather than a warning,
    // and it is also the proof the predicate discriminates on real text — it went RED on first run,
    // before any mutation, and the fix was to reword the comment rather than weaken the arm.
    // ⚠️ MEASURED, not reasoned: dropping the backslash from the regex does NOT make this arm RED on
    // its own text (an earlier draft of this comment claimed it did). `/CAP (\d/` is an unterminated
    // group, so the FILE STOPS PARSING and every arm vanishes — a VOID reading, not a red one. The
    // ✅ AND THE VALID MUTATION EXISTS — built 2026-09-21, because my own
    // read was that this arm might be decorative and a void reading is the THIRTEENTH
    // vacuous-control shape. Plant the banned shape as an ORDINARY COMMENT LINE (the file keeps
    // parsing, so the reading is a RED and not a void): one line, and this arm goes FAIL with
    // exactly one failure while the other 118 stay green. The arm discriminates. Do not delete it.
    // This arm
    // refuses that SHAPE anywhere in this file's own source. It is deliberately keyed on the rendered
    // form `CAP (` + a digit; the arm's own regex literal spells that as an ESCAPED paren, so the
    // predicate cannot match itself (the FOURTEENTH vacuous-control way, checked rather than assumed
    // — mutate the escape out and this arm goes RED on its own text, which is the proof it discriminates).
    ["this file restates the injector's CAP nowhere",
      (readFileSync(fileURLToPath(import.meta.url), "utf8").match(/CAP \(\d/g) || []).length === 0],
  ];
  for (const [label, got] of trapsCases) {
    if (!got) fail++;
    console.log(`  [${got ? "PASS" : "FAIL"}] traps-plane: ${label}`);
  }

  // ⛔ HAND-MAINTAINED SUM — add your array here or your arms RUN AND GO UNCOUNTED. Measured
  // 2026-09-13: ten new arms printed PASS while this total stayed at 78, so the headline number
  // was identical before and after, which is exactly the declared-count failure the rules corpus
  // warns about. The arms below are +20 (pfGateCases 9, enfCases 9, two inline arms).
  const n = cases.length + gateCases.length + ratchetCases.length + dirCases.length + 1
    + glCases.length + prCases.length + pfCases.length + setCases.length + scopeCases.length + floorCases.length
    + deliveredArms + planeCases.length + renderCases.length
    + pfGateCases.length + enfCases.length + govCases.length + trapsCases.length + 2;
  console.log(fail ? `FAILED: ${fail} failure(s)` : `OK: ${n} pass / 0 fail`);
  return fail ? 1 : 0;
}

if (process.argv[2] === "--self-test") {
  process.exit(selfTest());
}
// --check is a FIRST-CLASS alias for the default band check (a rot-trap fold):
// defer-trigger-scan's EXIT_ZERO_TARGETS pins the exact string
// `node scripts/check-band-budget.mjs --check` as a VERIFIED-PURE behavioral done-when,
// so this mode is CONTRACTED to stay the plain read-only check. Any OTHER flag errors
// loudly — a future mode addition must be deliberate, never a silent repurpose of the
// allowlisted string.
// `--ratchet` is the ONLY writing mode, and it is deliberately NOT reachable from `--check` or
// from the default (pre-push) path — see the ONE-WAY RATCHET block above for why.
if (process.argv[2] === "--ratchet") {
  const r = readRatchet();
  if (r === "CORRUPT") {
    console.error(`check-band-budget --ratchet: ${RATCHET_FILE} is PRESENT but unparseable — refusing to touch it. Fix or restore it first.`);
    process.exit(2);
  }
  if (!r) {
    console.error(`check-band-budget --ratchet: ${RATCHET_FILE} is missing — nothing to ratchet.`);
    process.exit(2);
  }
  const headNow = baselineTotal("HEAD");
  const p = ratchetProposal(r, headNow);
  if (p.kind === "no-measurement") {
    console.error("check-band-budget --ratchet: could not measure the HEAD-plane band (unresolvable ref?) — refusing to write.");
    process.exit(2);
  }
  if (p.kind === "none") {
    console.log(`ratchet: no down-move — HEAD band ${kb(p.headTotal)} is not below the recorded minimum ${kb(r.observedMin)}.`);
    console.log("         The ratchet only ever moves DOWN; raising the ceiling means editing BLOCK_BYTES with a documented basis.");
    process.exit(0);
  }
  if (p.kind === "implausible") {
    console.error(`ratchet: REFUSED — HEAD band ${kb(p.headTotal)} is ${kb(p.drop)} below the recorded minimum ${kb(r.observedMin)}, a drop of ${(100 * p.drop / r.observedMin).toFixed(1)}% (> ${(100 * RATCHET_MAX_DROP_FRACTION).toFixed(0)}%).`);
    console.error("        That is likelier a broken instrument or a mid-surgery tree than a real cut, and locking the fleet's");
    console.error("        ceiling to a transient value blocks every push. If the cut is real, edit observedMin by hand and say so.");
    process.exit(2);
  }
  const next = { ...r.raw, observedMin: p.headTotal };
  next.history = Array.isArray(r.raw.history) ? [...r.raw.history] : [];
  next.history.push({
    ts: new Date().toISOString().slice(0, 10),
    observedMin: p.headTotal,
    note: `ratcheted down ${p.drop} B from ${r.observedMin} (HEAD plane)`,
  });
  writeFileSync(RATCHET_FILE, JSON.stringify(next, null, 2) + "\n");
  const before = effectiveLimits(r);
  const after = effectiveLimits({ observedMin: p.headTotal, marginBytes: r.marginBytes });
  console.log(`ratchet: observedMin ${r.observedMin} -> ${p.headTotal} B (down ${kb(p.drop)})`);
  console.log(`         effective ceiling ${kb(before.block)} -> ${kb(after.block)}`);
  console.log(`         COMMIT scripts/band-ratchet.json — an uncommitted ratchet is a local-only ceiling.`);
  process.exit(0);
}
// --check is a FIRST-CLASS alias for the default band check (a rot-trap fold):
// defer-trigger-scan's EXIT_ZERO_TARGETS pins the exact string
// `node scripts/check-band-budget.mjs --check` as a VERIFIED-PURE behavioral done-when,
// so this mode is CONTRACTED to stay the plain read-only check. Any OTHER flag errors
// loudly — a future mode addition must be deliberate, never a silent repurpose of the
// allowlisted string.
if (process.argv[2] && process.argv[2] !== "--check") {
  console.error(`check-band-budget: unknown flag ${process.argv[2]} — modes: (none|--check) = read-only band check · --self-test · --ratchet (the ONLY writing mode)`);
  process.exit(2);
}
const ratchet = readRatchet();
if (ratchet === "CORRUPT") {
  console.error(`check-band-budget: ${RATCHET_FILE.replace(ROOT + "/", "")} is PRESENT but unparseable/mis-shaped.`);
  console.error("  Refusing to run with the hard ceiling: silently un-ratcheting would WIDEN the live gate.");
  console.error("  Fix or restore the file (git checkout -- scripts/band-ratchet.json), then re-run.");
  process.exit(1);
}
// BLOCK, not warn: the baseline PASSES (both recorded raises already quote the owner), which is
// the condition warn-before-block discipline names for going straight to block.
{
  const gov = ratchetGovernance(ratchet?.raw);
  if (gov.length) {
    console.error(`check-band-budget: ${RATCHET_FILE.replace(ROOT + "/", "")} FAILS the up-move ritual.`);
    for (const p of gov) console.error(`  - ${p}`);
    console.error("  A raise of the corpus ceiling is an OWNER decision recorded here as a history entry");
    console.error("  quoting the owner's words. Add the entry, or put the ceiling back.");
    process.exit(1);
  }
}
const limits = effectiveLimits(ratchet);
const { total, rows, unclassified } = measure(bandFiles());
const { level, text } = render(total, rows, limits);
console.log(text);
// An always-loaded file that bandFiles() measures and classifyBandPath() cannot place is the exact
// 2026-08-15 shape: bytes in the total with nobody deciding which plane pays them. It counts as
// GATED here (fail-safe — it can only tighten), and it is LOUD, because silence is what let the
// last one sit for five weeks. --self-test carries the same assertion against the live tree.
if (unclassified.length > 0) {
  console.log(`  ⚠️  UNCLASSIFIED band file(s) — measured, counted as GATED, plane never decided: ${unclassified.join(" · ")}`);
  console.log(`     Add them to classifyBandPath() (and to GATED_PATHSPEC if they belong to the gated plane), or they distort the ceiling comparison.`);
}

// TRAPS PLANE REPORT — deliberately BELOW the band report and it does NOT exit here.
// ⛔ IT USED TO `process.exit(1)` ABOVE THE BAND REPORT, WHICH OVERLOADED rc=1 ONTO TWO PLANES.
// `.githooks/pre-push` prints, verbatim, "the always-loaded band exceeds its byte ceiling" on rc=1
// — and on a traps trip the band had NEVER BEEN MEASURED, because the exit fired first. That is the
// exact condition the adjacent crash branch's own comment exists to prevent ("is NOT 'the band is
// too big' — the band was never measured"), reproduced in the code it shares. Second consumer:
// `scripts/defer-trigger-scan.py`'s EXIT_ZERO_TARGETS pins this script under `--check` with the
// contract "exit 0 = band back under its byte ceiling", so a traps overage flipped an unrelated
// defer-trigger to not-discharged. (Found 2026-09-21 by
// running the failing arm in a fixture and reading what the CALLER prints, not what this script does.)
// Both planes now always print, and the traps plane carries its OWN exit code at the bottom.
const traps = measureTraps();
let trapsBlock = false;
if (traps.files > 0) {
  const trapsLevel = classifyTraps(traps.total);
  const cap = liveInjectorCap();
  console.log(`  TRAPS plane (.claude/traps/, delivered PER MATCHING COMMAND, not per turn): `
    + `${kb(traps.total)} (${traps.total} B) across ${traps.files} file(s) · loose ceiling `
    + `${kb(TRAPS_BLOCK_BYTES)} — ${trapsLevel.toUpperCase()}`);
  const docMax = liveInjectorDocMax();
  console.log(`     Cost is PER MATCHING COMMAND, and the emitted payload is bounded in CHARACTERS `
    + `by the injector's document clamp: `
    + `${docMax === null ? "UNKNOWN (shell-trap-inject.sh unreadable — do not assume a value)" : docMax + " chars"}`
    + `. Its CAP (${cap === null ? "unknown" : cap}) bounds only the SUM OF RULE BODIES — it is not the payload.`);
  if (trapsLevel === "block") {
    trapsBlock = true;
    console.error(`check-band-budget: the TRAPS plane exceeds its LOOSE ceiling by ${kb(traps.total - TRAPS_BLOCK_BYTES)}.`);
    console.error("  This is a tripwire, not a budget — the emitted payload is bounded per matching command by the injector's document clamp either way.");
    console.error("  It means the table roughly DOUBLED since adoption. Read it before raising this number.");
    console.error("  The BAND verdict is printed above and is unaffected: this plane exits 3, never 1.");
  }
}

// L3 delivered-plane report. Read-only (one file read), so `--check`'s purity pin is preserved;
// it prints nothing when the log is absent, which is the state on any fresh clone.
// ⚠️ This passes the WIDE total (gated + Band-O) on purpose — the delivery log records paths on
// both planes, so the source-plane figure is the right denominator for it. But it prints a second,
// LARGER "band" number a few lines under a headline that reads the GATED total, so the label is
// load-bearing: renderDelivered names it "source-plane" explicitly. Two unlabelled numbers for
// "the band" in one report is the reading confusion this file exists to remove.
for (const line of renderDelivered(deliveredPlane(), total)) console.log(line);

const baseRef = resolveBaseline();
const base = baselineTotal(baseRef);
// ⛔ BOTH DELTA OPERANDS MUST BE THE SAME KIND — a worktree-vs-commit delta is not a
// delta (2026-07-31). `total` above is the WORKTREE (statSync at
// :79); `base` is a COMMITTED TREE (ls-tree at :123). Mixing them fails OPEN: commit
// an over-budget band, leave a SMALLER worktree (uncommitted deletions, or mid-edit),
// and the delta reads <= 0 -> ALLOW -> the push ships the over-budget band with no
// signal. That is the exact silent-pass the gate exists to prevent, arriving through
// the operand nobody was looking at. It is not hypothetical: dirty worktrees on shared
// files have been the fleet's continuous state, and this is the same defect class as
// a sibling gate on the same hook.
// So the GATE reads HEAD — what the push actually publishes — through the SAME
// instrument as the baseline. The worktree total stays in the human-facing report
// above, where "what am I editing right now" is the reading you want.
// Unresolvable HEAD -> delta null -> gateDecision()'s fail-safe BLOCK branch.
const headTotal = baselineTotal("HEAD");
const delta = base === null || headTotal === null ? null : headTotal - base;
// The BINDING plane's own operands (2026-09-21). Read at the same two refs as the corpus pair, so
// the two planes can never be compared across different commits.
const baseAlways = alwaysTotalAt(baseRef);
const headAlways = alwaysTotalAt("HEAD");
const deltaAlways = baseAlways === null || headAlways === null ? null : headAlways - baseAlways;
if (delta !== null) {
  console.log(`  delta HEAD vs ${baseRef}: ${delta > 0 ? "+" : ""}${delta} B (both committed trees)`);
}
// RATCHET arm — read-only here BY CONTRACT. Surfaces an available down-move with the one command
// that records it; the write stays behind `--ratchet` so neither `--check`'s purity pin nor the
// pre-push path ever mutates a tracked file. See the ONE-WAY RATCHET block above.
const proposal = ratchetProposal(ratchet, headTotal);
if (proposal.kind === "available") {
  console.log(`  ratchet AVAILABLE: HEAD band is ${kb(proposal.drop)} below the recorded minimum (${kb(ratchet.observedMin)}).`);
  console.log(`     Lock the cut in so it cannot be silently re-spent:  node scripts/check-band-budget.mjs --ratchet  (then commit scripts/band-ratchet.json)`);
} else if (proposal.kind === "implausible") {
  console.log(`  ratchet: a ${kb(proposal.drop)} drop below the recorded minimum was measured but NOT auto-proposed (> ${(100 * RATCHET_MAX_DROP_FRACTION).toFixed(0)}% — verify the tree, then set observedMin by hand).`);
} else if (proposal.kind === "no-state") {
  console.log(`  ratchet: no state file (${RATCHET_FILE.replace(ROOT + "/", "")}) — the hard ceiling applies unchanged.`);
}

// PER-FILE arm. HEAD-plane, same as the delta above. A null here means HEAD is unresolvable, which
// the delta's own fail-safe already turns into a BLOCK — so this arm does not add a second one.
const perFile = perFileOffendersAtRef("HEAD");
// SAME REF AS THE BAND DELTA — one baseline for both arms, or the two gates disagree about what
// "this push" means. baseRef is null on a detached/fresh clone, and perFileOffendersAtRef(null)
// returns null, which perFileGateDecision turns into the fail-safe BLOCK.
const perFileBase = perFileOffendersAtRef(baseRef);
for (const [path, chars, enf] of perFile || []) {
  const lvl = classifyPerFile(chars);
  const tier = (enf ?? "block") === "block" ? "" : " [warn-tier: watched, not yet blocking]";
  // A SKILL.md is delivered WHOLE by the skill mechanism (perFileEnforcement's comment), so for it the
  // line is a growth signal; calling it the "harness limit" sold a split on a limit that does not bind it.
  const limitLabel = /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path) ? "growth line, not a delivery limit" : "harness limit";
  console.log(`  per-file ${lvl.toUpperCase()}: ${path} — ${chars} chars (warn ${PER_FILE_WARN_CHARS} · ${limitLabel} ${PER_FILE_BLOCK_CHARS})${tier}`);
}
const perFileGate = perFileGateDecision(perFile, perFileBase);
const perFileBlock = perFileGate.block;
if ((perFile || []).some(([, chars, enf]) => classifyPerFile(chars) === "block" && (enf ?? "block") === "block")) {
  console.log(`  per-file gate: ${perFileBlock ? "BLOCK" : "ALLOW"} — ${perFileGate.why} (baseline: ${baseRef ?? "unresolved"})`);
}
if (perFileBlock) {
  console.log(`     The harness silently degrades an always-loaded file past ${PER_FILE_BLOCK_CHARS} chars, and the band total cannot see it.`);
  // The archive is named by its role, not by a path: its directory was renamed SIXTEEN MINUTES after
  // this line first shipped. A remediation string is the
  // one kind of stale pointer that gets FOLLOWED — an operator meets it mid-block and would create a
  // second archive home. Re-check it against the tree if you touch it.
  console.log(`     Split it: directives stay in .claude/rules/, the incident record moves to the rules archive (a non-loaded directory).`);
  console.log(`     SKIP_BAND_BUDGET_CHECK=1 overrides.`);
}

// ⛔ THE GATE'S LEVEL OPERAND MUST BE THE SAME PLANE AS ITS DELTA (2026-08-13,
// confirmed at source). `level` above is the WORKTREE reading — correct for the human
// report, wrong for the gate: gateDecision() returns on `level !== "block"` BEFORE delta
// is consulted, so a dirty shrink (HEAD over the ceiling, worktree under) exited ALLOW
// and the HEAD-plane delta fix was unreachable on exactly the path it was
// built for. The :566 comment ("the GATE reads HEAD") was true of the delta and false of
// the level — both operands feed one call; only one had the plane fix. Fail-safe:
// unresolvable HEAD keeps the worktree level (the delta is null there too, and
// gateDecision's null branch already blocks when over).
//
// PLANE (2026-08-24): all three operands are now the GATED plane and that is checkable here —
// `headTotal` and `base` are both `baselineTotal()` (GATED_PATHSPEC), and `level` is render()'s
// classification of the gated worktree subtotal. Before today the fallback `level` was the WIDER
// worktree total, so on the one path where it gates — HEAD unresolvable: an UNBORN repo, a non-repo
// cwd, or git unavailable; ⛔ NOT a detached worktree and NOT a fresh clone, both of which RESOLVE
// HEAD and take the ordinary path (measured 2026-08-24 — a real detached
// worktree read 21 rows and printed "level plane: HEAD"; see also :532 "HEAD always resolves").
// The first draft of this comment named those two, which would have sent a future maintainer to
// calibrate the fallback against a population that never reaches it — and none of the three states
// that DO reach it can run .githooks/pre-push at all.
// Band-O's bytes could push a within-ceiling band to BLOCK there. ⚠️ That over-block was a UNIT
// ERROR, not a safety property: the ceiling is ratcheted from observedMin, itself written by
// baselineTotal() on the GATED plane, so comparing gated+Band-O against a gated-calibrated ceiling
// was mixing planes. The new behaviour on that path is the CORRECT comparison, not a fail-open.
// TWO PLANES, TWO DECISIONS, ORed. Each plane is judged against ITS OWN ceiling and ITS OWN delta;
// pairing the binding plane's level with the corpus plane's delta would let growth in scoped files
// unblock a breach of what actually loads, and vice versa.
const corpusHeadLevel = computeGateLevel(level, headTotal, limits);
const alwaysHeadLevel = headAlways === null ? level : headAlways > ALWAYS_BLOCK_BYTES ? "block" : "ok";
const corpusGate = gateDecision(corpusHeadLevel, delta);
const alwaysGate = gateDecision(alwaysHeadLevel, deltaAlways);
const gateLevel = worseLevel(corpusHeadLevel, alwaysHeadLevel);
const gate = alwaysGate.block
  ? { block: true, why: `BINDING plane — ${alwaysGate.why}` }
  : corpusGate.block
    ? { block: true, why: `CORPUS plane — ${corpusGate.why}` }
    : { block: false, why: `BINDING ${alwaysGate.why} · CORPUS ${corpusGate.why}` };
if (gateLevel === "block") {
  console.log(`  gate: ${gate.block ? "BLOCK" : "ALLOW"} — ${gate.why} (level plane: HEAD)`);
}
// ⛔ THREE EXIT CODES, THREE QUESTIONS — rc=1 means "the BAND is over", and nothing else may claim it.
//   0 = everything under its ceiling            1 = the always-loaded BAND (or a per-file cap) is over
//   3 = the BAND is fine and the TRAPS plane tripped its loose tripwire
// `--check` answers the BAND question ONLY: `scripts/defer-trigger-scan.py` pins that exact command
// with the contract "exit 0 = band back under its byte ceiling", so letting a traps overage colour
// its rc would flip an unrelated defer-trigger to not-discharged. The traps line still PRINTS there.
const TRAPS_RC_SUPPRESSED = process.argv[2] === "--check";
if (gate.block || perFileBlock) process.exit(1);
process.exit(trapsBlock && !TRAPS_RC_SUPPRESSED ? 3 : 0);
