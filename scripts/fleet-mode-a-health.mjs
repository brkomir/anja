#!/usr/bin/env node
/**
 * Mode A (fleet-inquiry topology-2) health gates — G1..G5, COMPUTED.
 *
 * Exists because the pilot cannot score itself. Every number here comes
 * from `.claude/logs/mail-events.jsonl` (append-only, one `send` per message by
 * construction) + the mail store's message BODIES — never from the lead's
 * account of the run.
 *
 * Why the event log and not the file store: a file count over the store counts
 * `.read-by-<peer>` RECEIPTS, not messages (~10x inflation, measured 2026-07-28);
 * anchoring on `.md$` flips the sign (11-32% deflation, consumed bases). The
 * event log has neither failure mode. Where a BODY must be read (G3/G4), the
 * store is the only source, so those two gates are floors with respect to a
 * fully-deleted message — stated in the output rather than hidden.
 *
 * Usage:  node scripts/fleet-mode-a-health.mjs <slug> [--lead <sid8>]
 *   <slug>  the inquiry slug carried in every round subject, e.g. "spine-fork"
 *
 * Convention this script depends on (see fleet-inquiry/SKILL.md § Mode A):
 *   every round message subject starts `[<slug> R<n>]`, and every spoke message
 *   body carries a `basis-change:` line.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Overridable so the gates can be exercised against a fixture WITHOUT writing
// into the live mail store. A health script whose only proof is "it does not
// crash on an empty slug" is a one-sided oracle.
const EVENTS = process.env.FLEET_MAIL_EVENTS ?? ".claude/logs/mail-events.jsonl";
const STORE = process.env.FLEET_MAIL_STORE ?? ".claude/state/session-mail";
const ROUND_BUDGET = 3; // + at most 1 logged extension (G1)
const WAKE_BUDGET = 60; // G5

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const lead = args[args.indexOf("--lead") + 1];
if (!slug) {
  console.error("usage: node scripts/fleet-mode-a-health.mjs <slug> [--lead <sid8>]");
  process.exit(2);
}

// ── Message bodies: the only source for subject + basis-change + PARTIAL-ROUND.
// Dedupe on the ns stamp (the message identity) so receipts never inflate.
const byId = new Map();
if (existsSync(STORE)) {
  for (const f of readdirSync(STORE)) {
    const id = f.replace(/\.md.*$/, "");
    if (byId.has(id) || !f.includes("__")) continue;
    let body = "";
    try {
      body = readFileSync(join(STORE, f), "utf8");
    } catch {
      continue; // a receipt/partial we cannot read is not a message
    }
    if (!body.includes(`[${slug} R`)) continue;
    // Prefer the BODY headers over the filename: the `to__ns__from` filename
    // shape is a convention, and parsing an inferred format is how a well-formed
    // wrong number gets produced. The headers are what
    // mail-send actually writes; the filename is the fallback.
    const from = body.match(/^from:\s*(\S+)/m)?.[1]
      ?? id.match(/^[^_]+__\d+__(.+)$/)?.[1];
    const to = body.match(/^to:\s*(\S+)/m)?.[1]
      ?? id.match(/^([^_]+)__\d+__/)?.[1];
    const round = body.match(new RegExp(`\\[${slug} R(\\d+)`))?.[1];
    byId.set(id, {
      id,
      to,
      from,
      round: round ? Number(round) : null,
      hasBasis: /^basis-change:/m.test(body),
      basisNone: /^basis-change:\s*none\s*$/im.test(body),
      position: body.match(/^position:\s*(\S+)/im)?.[1] ?? null,
      partial: /\[PARTIAL-ROUND\]/.test(body),
      contested: Number(body.match(/^contested:\s*(\d+)/im)?.[1] ?? NaN),
      hasAnchor: /[\w./-]+\.(ts|tsx|mjs|md|json|sql|py|sh):\d+|\$ |```/.test(body),
    });
  }
}
const msgs = [...byId.values()];
const rounds = [...new Set(msgs.map((m) => m.round).filter(Boolean))].sort();
const spokeMsgs = msgs.filter((m) => m.from !== lead);

// ── Wakes: read + surfaced-live events on THIS inquiry's messages.
let wakes = 0;
if (existsSync(EVENTS)) {
  for (const line of readFileSync(EVENTS, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.event === "send") continue;
    if (byId.has(String(e.mail ?? "").replace(/\.md.*$/, ""))) wakes += 1;
  }
}

const g2Violations = lead ? spokeMsgs.filter((m) => m.to !== lead && m.to !== "all") : [];
const g3Missing = spokeMsgs.filter((m) => !m.hasBasis || !m.hasAnchor || !m.position);
const partials = msgs.filter((m) => m.partial);

// ── G7: social convergence. A seat whose `position:` moved while declaring
// `basis-change: none` moved for a reason that is not evidence. This is the ONLY
// gate that measures what verdict-stripping / the blind final / basis-change all
// target; without it a run can pass 6/6 with every seat quietly adopting the
// lead's framing. REPORTED, NOT BLOCKING on run 1 — no baseline exists and a
// guessed threshold fails in whichever direction the guess was wrong.
const prior = new Map();
const g7Drifts = [];
for (const m of spokeMsgs.slice().sort((a, b) => (a.round ?? 0) - (b.round ?? 0))) {
  if (!m.position) continue;
  const was = prior.get(m.from);
  if (was && was !== m.position && m.basisNone) {
    g7Drifts.push(`${m.from} R${m.round}: ${was} → ${m.position} with basis-change: none`);
  }
  prior.set(m.from, m.position);
}

// ── Thinness: pre-registered BEFORE the pilot. R2 with zero contested items means
// the debate tested nothing — the round budget or the lead-bar is wrong. Read from
// the lead's own R2 synthesis so the criterion is computed, not adjudicated.
const r2Synth = msgs.find((m) => m.round === 2 && m.from === lead && !Number.isNaN(m.contested));
const thinness = r2Synth
  ? r2Synth.contested === 0
    ? "TOO THIN — R2 contested: 0. Per the pre-registered criterion the round budget or the lead-bar is wrong; run 1 is informative in THAT direction, not inconclusive."
    : `ok — R2 contested: ${r2Synth.contested}`
  : "UNREADABLE — the lead's R2 synthesis carries no `contested: <n>` line";

const gates = [
  ["G1", `closed within ${ROUND_BUDGET} rounds (+≤1 logged extension)`,
    rounds.length > 0 && rounds.length <= ROUND_BUDGET + 1,
    `${rounds.length} round(s): ${rounds.join(", ") || "none"}`],
  ["G2", "0 peer-to-peer messages (spokes address the lead only)",
    lead ? g2Violations.length === 0 : null,
    lead ? `${g2Violations.length} violation(s)` : "SKIPPED — pass --lead <sid8>"],
  // NAME says SHAPE, because SHAPE is what it computes. A regex-matched
  // `foo.ts:412` is a well-formed citation, not a supporting one — and the gate's
  // name is what gets quoted into the run report.
  ["G3", "every spoke message carries position: + basis-change: + an anchor-SHAPED citation",
    g3Missing.length === 0 && spokeMsgs.length > 0,
    `${spokeMsgs.length - g3Missing.length}/${spokeMsgs.length} compliant`],
  ["G4", "[PARTIAL-ROUND] = 0, else the close report caps confidence at Medium",
    partials.length === 0 ? true : null,
    partials.length === 0 ? "none" : `${partials.length} — CAP CONFIDENCE AT MEDIUM in the report`],
  ["G5", `total wakes ≤ ${WAKE_BUDGET}`, wakes <= WAKE_BUDGET, `${wakes} wake(s)`],
  ["G7", "social convergence: position moved with basis-change: none  [REPORTED, not blocking]",
    null,
    g7Drifts.length === 0
      ? "0 unexplained position changes"
      : `${g7Drifts.length}: ${g7Drifts.join(" · ")}`],
];

console.log(`\nMode A health — inquiry "${slug}"${lead ? ` · lead ${lead}` : ""}`);
console.log(`messages: ${msgs.length} (${spokeMsgs.length} from spokes)\n`);
for (const [id, desc, pass, detail] of gates) {
  const mark = pass === true ? "PASS" : pass === false ? "FAIL" : "MANUAL";
  console.log(`  ${mark.padEnd(6)} ${id}  ${desc}\n         ${detail}`);
}
console.log(`\n  THINNESS (pre-registered before the pilot)\n         ${thinness}`);
console.log(
  "\nG6 (one owner report; a split presents both positions + a recommendation) is a human read.",
);
// A measurement states its own blind spots in its own output, so a reader quoting
// a gate into a run report inherits the caveat with the number.
console.log("\nWHAT THESE GATES CANNOT SEE — carry this with any number quoted from them:");
console.log(
  "  G2  exact about ACCIDENTAL cascade (it reads `to:` headers); BLIND to deliberate",
);
console.log(
  "      out-of-band coordination — a spoke can address the lead and coordinate elsewhere.",
);
console.log(
  "  G3  checks citation SHAPE, never whether the citation SUPPORTS its claim (a well-formed",
);
console.log("      file:line can point at a comment). Judging that is the lead's job, not a gate's.");
console.log("  G3/G4  read message BODIES, so a fully-DELETED message is invisible to them.");
console.log("  G7  counts DECLARED basis-change; a seat that writes a basis it did not act on is unseen.");
console.log("  G1/G2/G5 are event-log-derived and exact. Do not report any of these as lead-asserted.\n");
process.exit(gates.some(([, , p]) => p === false) ? 1 : 0);
