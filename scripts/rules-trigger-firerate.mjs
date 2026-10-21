#!/usr/bin/env node
/**
 * rules-trigger-firerate.mjs
 *
 * Measures actual fire-rate of trigger phrases declared in the always-loaded
 * rule layer (`.claude/rules/active-recall.md` + `behavioral-anti-patterns.md`)
 * against real session transcripts.
 *
 * Closes architecture.md:944 + 1131 — "calibrated by gut" / "if a trigger
 * never fires, the rule is dead."
 *
 * v2 (2026-05-22): JSON-parses each jsonl line, splits by speaker (user vs
 * assistant), strips system-reminders + skill-body + command-message blocks
 * before counting. Removes the rule-file self-mention floor that polluted v1.
 *
 * Usage:
 *   node scripts/rules-trigger-firerate.mjs            # default 30-day window
 *   node scripts/rules-trigger-firerate.mjs --days=14
 *   node scripts/rules-trigger-firerate.mjs --top=20 --dead=50
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// overridable so a test can run the parking logic over a fixture tree and an empty session store
const ROOT = process.env.RULES_FIRERATE_ROOT || "<repo-root>";
const SESSIONS_DIR = process.env.RULES_FIRERATE_SESSIONS_DIR || "<home>/.claude/projects/<project-key>";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
// ⛔ HELP PATH BEFORE ANY WORK — without it `--help` folds into `args` unread and SILENTLY RUNS
// the full 30-day scan over the whole session store (~60 MB). Inverse of an earlier case: there the helpful
// exit-0 path made a gate false-green; here the help REQUEST does the expensive work. Found
// 2026-08-26 (the in-window invocation printed a report, not usage).
if (args.help || args.h) {
  console.log(`rules-trigger-firerate.mjs — measure which always-loaded trigger phrases actually fire.

usage: node scripts/rules-trigger-firerate.mjs [--days=N] [--top=N] [--dead=N]
  --days=N   lookback window over the session store (default 30)
  --top=N    how many top-firing rows to print (default 15)
  --dead=N   TRUE-DEAD threshold in days (default 30)

Reads the session transcript store; a bare run scans the full window and is NOT cheap.`);
  process.exit(0);
}

const DAYS = parseInt(args.days ?? "30", 10);
const TOP = parseInt(args.top ?? "15", 10);
const DEAD = parseInt(args.dead ?? "30", 10);

// Every always-loaded trigger band must be listed here — this is the ONLY instrument that can
// name a dead rule, so a band missing from SOURCES is a band whose rows can never be demoted.
// Band-O (.claude/orchestrator/) was added 2026-07-12: the 2-band split moved 25 orchestrator-only
// rows OUT of .claude/rules/ into a hook-injected file, and this list did not follow them — the
// demotion instrument went silently blind to them the moment they were promoted out of its scope.
// (The same enumerate-both-band-paths rule a conformance harness must generalize.)
// Adding a band? Add it here in the SAME change.
const SOURCES = [
  { name: "active-recall.md", path: `${ROOT}/.claude/rules/active-recall.md` },
  { name: "behavioral-anti-patterns.md", path: `${ROOT}/.claude/rules/behavioral-anti-patterns.md` },
  // `envSwitch`: this band is delivered by a HOOK (band-o-inject.sh), so it is parked by an env
  // flag in .claude/settings.json rather than by frontmatter. See the parking block below.
  { name: "active-recall-orchestrator.md", path: `${ROOT}/.claude/orchestrator/active-recall-orchestrator.md`, envSwitch: "SKIP_BAND_O_INJECT" },
];

// Phrases too generic to measure meaningfully (false-positive prone)
const STOP_WORDS = new Set([
  "user", "assistant", "tool_use", "tool_result", "text", "type",
  "done", "perfect", "okay", "thanks", "yes", "no", "ok", "good call",
]);

// Filters for non-measurable extraction artifacts (URLs, L#-refs, regex/template
// fragments, code-mentions, shell vars, placeholders). A real situational cue is
// human-readable prose; these are example-text the quote-extractor caught.
function skipPhrase(phrase) {
  if (STOP_WORDS.has(phrase.toLowerCase())) return true;
  if (/^L\d+/.test(phrase)) return true;
  if (phrase.includes("://")) return true;
  if (phrase.includes("|") && /[()[\]*?^${}]/.test(phrase)) return true;
  if (/<[a-z_]+>/i.test(phrase)) return true;
  if (phrase.includes("`")) return true;
  if (/^\$[A-Z_]+$/.test(phrase) || /^\$\{/.test(phrase)) return true;
  if (phrase.length < 6 && !phrase.includes(" ")) return true;
  // regex / grep example fragments — a real cue never carries a caret or
  // backslash (only `grep -v "^ *at"`-style example text does)
  if (/[\^\\]/.test(phrase)) return true;
  // ellipsis-terminated placeholders ("you'll need to...") — a truncated
  // stand-in for a class of phrasings, never a literal match
  if (/(\.\.\.|…)$/.test(phrase)) return true;
  return false;
}

// Extract quoted trigger phrases. Two structural fixes (2026-06-20):
//  (1) L# attribution is PER-ROW (the Evidence column of each table row), NOT
//      the section's last L# — the old bug collapsed every Hot-Tier phrase onto
//      the table's final-row L# (every phrase was credited to that one row's lesson).
//  (2) each phrase is tagged with the CELL it came from: a quote in the first
//      (trigger) column is a matchable cue; a quote in an action column is an
//      example / outcome (→ illustrative), so the two are no longer conflated.
function extractTriggers(content, sourceName) {
  const triggers = [];
  const sections = content.split(/\n(?=## |### )/);
  for (const section of sections) {
    const lMatches = [...section.matchAll(/\bL(\d+)\b/g)].map((m) => `L${m[1]}`);
    const sectionLRef = lMatches[lMatches.length - 1] ?? null;
    for (const line of section.split("\n")) {
      const isTableRow = /^\s*\|/.test(line) && (line.match(/\|/g) || []).length >= 3;
      if (isTableRow) {
        const cells = line.split("|").slice(1, -1); // strip leading/trailing empties
        if (cells.every((c) => /^[\s:-]*$/.test(c))) continue; // header separator |---|
        const evidence = cells[cells.length - 1] || "";
        const rowLs = [...evidence.matchAll(/\bL(\d+)\b/g)].map((m) => `L${m[1]}`);
        const lRef = rowLs[0] ?? sectionLRef; // this ROW's evidence L#, not the section's
        cells.forEach((cell, ci) => {
          const col = ci === 0 ? "trigger" : "action";
          for (const m of cell.matchAll(/"([^"\n]{4,80})"/g)) {
            const phrase = m[1].trim();
            if (skipPhrase(phrase)) continue;
            triggers.push({ phrase, source: sourceName, lRef, col });
          }
        });
      } else {
        // prose line (behavioral-anti-patterns entries, section intros): the
        // section's L# is the right attribution; quotes here are cues.
        for (const m of line.matchAll(/"([^"\n]{4,80})"/g)) {
          const phrase = m[1].trim();
          if (skipPhrase(phrase)) continue;
          triggers.push({ phrase, source: sourceName, lRef: sectionLRef, col: "prose" });
        }
      }
    }
  }
  return triggers;
}

function dedupePhrases(triggers) {
  const map = new Map();
  for (const t of triggers) {
    const key = t.phrase.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { ...t, allLRefs: t.lRef ? [t.lRef] : [] });
    } else {
      const existing = map.get(key);
      if (t.lRef && !existing.allLRefs.includes(t.lRef)) {
        existing.allLRefs.push(t.lRef);
      }
      // a phrase that appears as a genuine trigger-column cue ANYWHERE is a
      // trigger, even if it also shows up as an action-column example elsewhere
      if (t.col === "trigger" && existing.col !== "trigger") existing.col = "trigger";
    }
  }
  return [...map.values()];
}

// Classify a phrase by rule-surface KIND, so the report separates genuine
// matchable triggers from two extraction false-positives (added 2026-06-17 —
// the old flat "dead" list was ~80% these two artifact classes, masking the
// real cold-trigger signal):
//  - suppression  = behavioral-anti-patterns.md Red-Flag rationalizations the
//    model is told NOT to emit → their ABSENCE is the success condition, so
//    they must NEVER be reported as "dead trigger / demotion candidate".
//  - illustrative = example-fragments the extractor pulls out of action cells
//    that were never meant to literal-match (placeholder X/Y/Z/N slots, emphatic
//    "do NOT" directive sentences, long multi-item slash-enumeration lists).
//  - trigger      = a genuine matchable situational cue (the default).
function classifyPhrase(phrase, source, col) {
  if (source === "behavioral-anti-patterns.md") return "suppression";
  // action-column quotes are examples / outcomes the rule references, not the
  // matchable cue (the cue lives in the first column) — structural signal that
  // replaces the old X/Y/Z/N + slash-enum heuristics for action-cell fragments
  if (col === "action") return "illustrative";
  // derivation/conclusion examples ("no client lib in the codebase → none
  // needed") — an inference chain the rule QUOTES as an example of a
  // claim-SHAPE. Never a literal transcript cue; counting one as a genuine
  // trigger puts it in TRUE-DEAD and risks a wrong demotion (2026-07-19).
  if (/[→⇒]/.test(phrase)) return "illustrative";
  if (/\b[XYZN]\b/.test(phrase)) return "illustrative";
  if (/do NOT/.test(phrase)) return "illustrative";
  if ((phrase.match(/ \/ /g) || []).length >= 2 && phrase.length > 18) return "illustrative";
  return "trigger";
}

// Strip noise blocks (system reminders, skill bodies, command messages,
// tool-result paste-ins) so only genuine user/assistant message text remains.
function cleanText(text) {
  let t = text;
  // System reminders are the BIGGEST source of self-mention pollution —
  // they re-paste rule files into user-role messages on session start /
  // post-compact / various harness events.
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  // Skill body re-injections (when /skill is invoked the body lands in a
  // user-role message starting with "Base directory for this skill:")
  if (t.startsWith("Base directory for this skill:")) return "";
  // Command-message wrapper blocks (the /command invocation itself)
  t = t.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  t = t.replace(/<command-name>[\s\S]*?<\/command-name>/g, "");
  t = t.replace(/<command-args>[\s\S]*?<\/command-args>/g, "");
  t = t.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  t = t.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  // Tool-result re-pastes injected back into user-role messages
  if (t.startsWith("Called the Read tool") || t.startsWith("Result of calling")) return "";
  // CLAUDE.md auto-load wrapper
  t = t.replace(/# claudeMd[\s\S]*?(?=\n# |\n<|$)/g, "");
  t = t.replace(/Contents of [\/].*\.md[\s\S]*?(?=\nContents of |\n# |\n<|$)/g, "");
  return t;
}

function extractSpeakerTexts(jsonlPath) {
  // Returns { user: lowercased-string, assistant: lowercased-string } —
  // genuine speaker text only, noise stripped.
  let content;
  try {
    content = readFileSync(jsonlPath, "utf8");
  } catch {
    return { user: "", assistant: "" };
  }
  const userChunks = [];
  const assistantChunks = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const msg = obj.message;
    if (!msg || !msg.role) continue;
    let segments;
    if (typeof msg.content === "string") {
      segments = [{ type: "text", text: msg.content }];
    } else if (Array.isArray(msg.content)) {
      segments = msg.content;
    } else { continue; }
    for (const seg of segments) {
      if (seg.type !== "text") continue;
      const cleaned = cleanText(seg.text || "");
      if (!cleaned.trim()) continue;
      if (msg.role === "user") userChunks.push(cleaned);
      else if (msg.role === "assistant") assistantChunks.push(cleaned);
    }
  }
  return {
    user: userChunks.join(" ").toLowerCase(),
    assistant: assistantChunks.join(" ").toLowerCase(),
  };
}

function countAll(haystack, needle) {
  if (!haystack || !needle || needle.length < 4) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// === Main ===

const allTriggers = [];
const parkedSources = [];   // parked by `paths:` frontmatter — delivered on no turn
const envParkedSources = []; // parked by an env switch in .claude/settings.json — hook never injects
const parkedNames = new Set(); // one entry per parked source, however it is parked — a source both path-scoped and env-switched counts once

// ⛔ PARKING HAS MORE THAN ONE MECHANISM AND THIS INSTRUMENT KNEW ONLY ONE (found
// 2026-09-09). The frontmatter test below catches a `paths:`-scoped band. It CANNOT catch a band
// delivered by a HOOK and switched off by an env flag — which is exactly how Band-O was parked in
// the 2026-09-07 exhortation cut (`SKIP_BAND_O_INJECT: "1"` in .claude/settings.json). Result: 2 of
// the 3 parked sources were reported and the third read as LIVE, so its undelivered rows scored as
// TRUE-DEAD and became demotion candidates. A row cannot be dead in a window where nothing could
// have delivered it. Reading the switch is deliberately TOLERANT: a missing or malformed
// settings.json must leave the band reported as live (an over-eager "parked" would suppress real
// deadness findings), so every failure path here falls through to {}.
let SETTINGS_ENV = {};
try {
  const raw = readFileSync(join(ROOT, ".claude/settings.json"), "utf8");
  SETTINGS_ENV = (JSON.parse(raw) || {}).env || {};
} catch {
  SETTINGS_ENV = {};
}
const envOn = (k) => {
  const v = SETTINGS_ENV[k];
  return v === true || v === 1 || (typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false");
};
for (const src of SOURCES) {
  const content = readFileSync(src.path, "utf8");
  // A PATH-SCOPED source (YAML `paths:` in its frontmatter) is delivered on no turn, so a
  // zero-fire row in it is UNDELIVERED, not dead — this instrument keys on MEMBERSHIP and
  // cannot see the difference (2026-09-07: both exhortation bands
  // were parked, and a naive run would read every row in them as a deletion candidate).
  if (/^---\n[\s\S]*?^paths:/m.test(content.slice(0, 2000))) { parkedSources.push(src.name); parkedNames.add(src.name); }
  // Report the KEY, never the VALUE: only truthiness is informative here, and `settings.json`
  // is a mixed file whose env block can hold sensitive entries — printing a value from it
  // would put it in every report and transcript for no gain (bash-safety-warn class).
  if (src.envSwitch && envOn(src.envSwitch)) { envParkedSources.push(`${src.name} (${src.envSwitch} is set)`); parkedNames.add(src.name); }
  // the frontmatter is not a rule row: a quoted `paths:` glob would otherwise be extracted as a trigger phrase
  allTriggers.push(...extractTriggers(content.replace(/^---\n[\s\S]*?\n---\n/, ""), src.name));
}
const unique = dedupePhrases(allTriggers);

const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
const jsonlFiles = readdirSync(SESSIONS_DIR)
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => {
    const path = join(SESSIONS_DIR, f);
    const st = statSync(path);
    return { name: f, path, mtime: st.mtime };
  })
  .filter((f) => f.mtime.getTime() >= cutoffMs)
  .sort((a, b) => b.mtime - a.mtime);

console.log(`# rules-trigger-firerate report (v2 — speaker-split + noise-stripped)\n`);
console.log(`- Window: last ${DAYS} days (${jsonlFiles.length} session files)`);
if (parkedSources.length) console.log(`- ⚠️ PATH-SCOPED (parked) sources: ${parkedSources.join(", ")} — zero fires in these read as UNDELIVERED, never dead; demotion on this reading is void while the parking stands.`);
if (envParkedSources.length) console.log(`- ⚠️ ENV-SWITCHED (parked) sources: ${envParkedSources.join(", ")} — the injecting hook is OFF in .claude/settings.json, so these rows reached no turn in this window. Same rule as above: UNDELIVERED, never dead.`);
const ALL_PARKED = parkedNames.size >= SOURCES.length;
if (ALL_PARKED) console.log(`- ⛔ ALL ${SOURCES.length} SOURCES ARE PARKED — this run measures nothing about deadness. Every zero below is undelivered by construction.`);
console.log(`- Sources: ${SOURCES.map((s) => s.name).join(", ")}`);
console.log(`- Triggers extracted: ${unique.length} unique phrases\n`);

// Initialize fire counts per phrase, split by speaker.
const fireMap = new Map(
  unique.map((t) => [t.phrase.toLowerCase(), { user: 0, assistant: 0, lastMtime: null }]),
);

let totalUserChars = 0;
let totalAssistantChars = 0;

for (const file of jsonlFiles) {
  const { user, assistant } = extractSpeakerTexts(file.path);
  totalUserChars += user.length;
  totalAssistantChars += assistant.length;
  for (const t of unique) {
    const p = t.phrase.toLowerCase();
    const uc = countAll(user, p);
    const ac = countAll(assistant, p);
    if (uc + ac > 0) {
      const entry = fireMap.get(p);
      entry.user += uc;
      entry.assistant += ac;
      if (!entry.lastMtime || file.mtime > entry.lastMtime) {
        entry.lastMtime = file.mtime;
      }
    }
  }
}

const results = unique.map((t) => {
  const f = fireMap.get(t.phrase.toLowerCase());
  return { ...t, ...f, total: f.user + f.assistant, klass: classifyPhrase(t.phrase, t.source, t.col) };
});

// Sort by user fires desc (user is the highest-quality signal — genuine
// triggers from the human; assistant fires are 2nd-tier because they may be
// self-discussion of the rule rather than rule-firing context).
results.sort((a, b) => b.user - a.user || b.total - a.total);

// Classification-aware buckets (2026-06-17): the actionable "dead" set is
// genuine triggers ONLY — suppression-targets (absence = good) and illustrative
// extraction-fragments (never literal cues) are reported separately, not as
// demotion candidates.
const triggers = results.filter((r) => r.klass === "trigger");
// genuine triggers only — an illustrative fragment "firing" is the same
// artifact one section down (2026-07-19)
const assistantOnly = triggers.filter((r) => r.user === 0 && r.assistant > 0);
const suppression = results.filter((r) => r.klass === "suppression");
const illustrative = results.filter((r) => r.klass === "illustrative");
const dead = triggers.filter((r) => r.total === 0); // TRUE cold genuine-triggers
// a parked source's zero is undelivered, not dead, also when only SOME sources are parked
const deadParked = dead.filter((r) => parkedNames.has(r.source));
const suppressionLeaks = suppression.filter((r) => r.total > 0); // ⚠️ a rationalization surfaced
const triggersUserLive = triggers.filter((r) => r.user > 0);

console.log(`## Summary\n`);
console.log(`- Text scanned: ${(totalUserChars / 1000).toFixed(0)}k chars user / ${(totalAssistantChars / 1000).toFixed(0)}k chars assistant (noise-stripped)`);
console.log(`- Phrases extracted: ${results.length} — **${triggers.length} genuine triggers** · ${suppression.length} suppression-targets (behavioral Red-Flags) · ${illustrative.length} illustrative fragments (extraction artifacts)`);
console.log(`- Genuine triggers with **user-side** fires: **${triggersUserLive.length}** / ${triggers.length} (${Math.round((100 * triggersUserLive.length) / Math.max(1, triggers.length))}%)`);
console.log(`- **TRUE-DEAD genuine triggers** (zero fires, artifacts excluded): **${dead.length - deadParked.length}** / ${triggers.length} (${Math.round((100 * (dead.length - deadParked.length)) / Math.max(1, triggers.length))}%) — ${ALL_PARKED ? "VOID: every source is parked, so these are undelivered, not dead" : "the actionable cold set"}${deadParked.length ? ` (+${deadParked.length} in parked sources: undelivered, not dead)` : ""}`);
console.log(`- Suppression-targets that LEAKED (rationalization actually appeared — ⚠️ rule may be failing): ${suppressionLeaks.length} / ${suppression.length}`);
console.log();

console.log(`## Top ${TOP} by user-side fires (genuine triggers)\n`);
console.log(`| # | Phrase | Source | L# | User | Asst | Last seen |`);
console.log(`|---|---|---|---|---|---|---|`);
const topUser = triggers.filter((r) => r.user > 0).slice(0, TOP);
for (let i = 0; i < topUser.length; i++) {
  const r = topUser[i];
  const lastSeen = r.lastMtime ? r.lastMtime.toISOString().slice(0, 10) : "—";
  const lRefs = r.allLRefs?.length ? r.allLRefs.join(", ") : "—";
  console.log(`| ${i + 1} | \`${r.phrase}\` | ${r.source} | ${lRefs} | ${r.user} | ${r.assistant} | ${lastSeen} |`);
}
console.log();

console.log(`## Assistant-only fires (no user-side trigger — model self-discussion)\n`);
if (assistantOnly.length === 0) {
  console.log(`*None.*`);
} else {
  const sortedAO = [...assistantOnly].sort((a, b) => b.assistant - a.assistant);
  console.log(`| Phrase | Source | L# | Asst fires |`);
  console.log(`|---|---|---|---|`);
  for (const r of sortedAO.slice(0, 20)) {
    const lRefs = r.allLRefs?.length ? r.allLRefs.join(", ") : "—";
    console.log(`| \`${r.phrase}\` | ${r.source} | ${lRefs} | ${r.assistant} |`);
  }
  if (sortedAO.length > 20) console.log(`\n*+${sortedAO.length - 20} more — re-run with \`--dead=${sortedAO.length}\` to expand*`);
}
console.log();

// Suppression-targets: behavioral-anti-patterns Red-Flags. Absence = SUCCESS.
console.log(`## Suppression-targets (behavioral-anti-patterns Red-Flags — absence = GOOD)\n`);
console.log(`Rationalizations the model is told NOT to emit. Zero fires = the layer working; an assistant-side fire = ⚠️ the rationalization actually surfaced (rule may be failing). NEVER demotion candidates — measuring them by occurrence is inverted.\n`);
if (suppressionLeaks.length === 0) {
  console.log(`✓ All ${suppression.length} suppression-targets absent in the window — anti-sycophancy / anti-defer / anti-LARP / anti-user-as-oracle layer is holding.`);
} else {
  console.log(`| Phrase | L# | ⚠️ Asst fires | User fires |`);
  console.log(`|---|---|---|---|`);
  for (const r of [...suppressionLeaks].sort((a, b) => b.assistant - a.assistant)) {
    const lRefs = r.allLRefs?.length ? r.allLRefs.join(", ") : "—";
    console.log(`| \`${r.phrase}\` | ${lRefs} | ${r.assistant} | ${r.user} |`);
  }
  console.log(`\n*${suppression.length - suppressionLeaks.length} / ${suppression.length} held (absent — good).*`);
}
console.log();

// Illustrative fragments: extraction artifacts, never literal cues.
console.log(`## Illustrative fragments (extraction artifacts — excluded from dead)\n`);
console.log(`${illustrative.length} phrases are example-text the extractor pulled from action cells (placeholder \`X\`/\`Y\`/\`Z\`/\`N\` slots, "do NOT" directive sentences, long slash-enumerations). Never meant to literal-match → absence is expected, NOT a rule problem. Excluded from the dead set so the cold signal isn't diluted.\n`);

console.log(`## TRUE-DEAD genuine triggers (zero fires in ${DAYS}d — ${ALL_PARKED ? "VOID while every source is parked" : "the actionable cold set"})\n`);
if (dead.length === 0) {
  console.log(`*None — every measurable trigger fired at least once in the window.*`);
} else {
  console.log(`| Phrase | Source | L# |`);
  console.log(`|---|---|---|`);
  for (const r of dead.slice(0, DEAD)) {
    const lRefs = r.allLRefs?.length ? r.allLRefs.join(", ") : "—";
    console.log(`| \`${r.phrase}\` | ${r.source}${parkedNames.has(r.source) ? " (parked: undelivered)" : ""} | ${lRefs} |`);
  }
  if (dead.length > DEAD) console.log(`\n*+${dead.length - DEAD} more dead phrases (re-run with \`--dead=${dead.length}\` to expand)*`);
}
console.log();

console.log(`## Methodology\n`);
console.log(`- **Noise stripping:** Each jsonl line parsed as JSON; \`message.content\` text segments extracted; \`<system-reminder>\`, \`<command-message>\`, \`<local-command-stdout>\`, "Base directory for this skill:", "Called the Read tool", "Result of calling" blocks/segments stripped or skipped entirely. This removes the rule-file self-mention floor that polluted v1.`);
console.log(`- **Speaker split:** \`message.role === "user"\` → user-side fires (genuine human-typed input). \`message.role === "assistant"\` → assistant-side fires (model self-discussion of the rule, NOT necessarily rule-firing context — these are a weaker signal).`);
console.log(`- **Classification (added 2026-06-17):** each phrase is typed as a genuine **trigger** (matchable situational cue), a **suppression-target** (behavioral-anti-patterns Red-Flag the model is told to SUPPRESS — absence = success, reported separately, never a demotion candidate), or an **illustrative fragment** (action-cell example text: placeholder X/Y/Z/N slots / emphatic "do NOT" directives / slash-enumerations / derivation-arrow examples ("X → Y" claim-shapes) — never a literal cue). Only genuine triggers with zero fires are TRUE-DEAD — this removes the ~80%-artifact dilution of the old flat "dead" count (which was mostly suppression-targets-working + illustrative-examples).`);
console.log(`- **Demotion candidates:** a genuine **trigger** (not a suppression-target, not illustrative) with zero user-side AND zero assistant-side fires. For a TRUE-DEAD trigger, diagnose before deleting: is it a legit concern whose phrase is too abstract (the lesson's principle-name) or a rationalization rather than the concrete situational cue that actually surfaces? If so → reword to the cue, don't delete.`);
console.log(`- **Sources:** \`active-recall.md\` (its Hot-Tier trigger→action rows) + \`behavioral-anti-patterns.md\` (its Iron-Law entries with explicit Triggers sections). The meta skill's rules catalog excluded — its catalog uses descriptive rule text, not discrete trigger phrases.`);
  // 2026-08-24: the SAME rot class was still live on the line above — it read "Hot Tier ~49
  // trigger→action rows" (actual activeRecallHotTier 37) and "8 Iron-Law entries" (actual 10).
  // The 2026-08-06 fix below deleted the ONE number its author noticed and left the two beside
  // it: an un-swept sibling inside the correction itself. Same remedy applied — deleted, not
  // re-derived, because the sentence's point is WHICH sources are used, never how big they are.
  // Derive live if ever needed:
  //   node scripts/architecture-counts.mjs list   →   activeRecallHotTier
  //   grep -c '^## #' .claude/rules/behavioral-anti-patterns.md
  // The row count was inlined here as "~448-row" and had rotted to roughly HALF the truth (actual
  // 804 as of 2026-08-06). A hand-typed count inside a REPORT is the shape nothing checks:
  // skill-lint's RULES_ROWCOUNT_DRIFT detector scanned CLAUDE.md, active-recall.md and
  // behavioral-anti-patterns.md — NOT this file — so the figure was free to drift indefinitely
  // (that detector was retired 2026-09-14: zero row-count claims remain in those files, by policy)
  // while sitting inside the very tool that reports on rule health. Deleted rather than
  // re-derived: the sentence's point is WHY the meta rules catalog is excluded, and its size was never
  // load-bearing for that. Derive it live if ever needed:
  //   node scripts/architecture-counts.mjs list   →   metaRulesRows
console.log(`- **L# / cell attribution (2026-06-20):** each phrase is attributed to the L# of its OWN table row (the Evidence column), and tagged by source cell — first-column quotes are matchable cues, action-column quotes are illustrative examples. Fixes the prior section-level L# clustering (everything read as the table's final-row L#) + the action-cell artifact leak into the dead set.`);
console.log(`- **Stop-listed:** ${[...STOP_WORDS].join(", ")}`);
