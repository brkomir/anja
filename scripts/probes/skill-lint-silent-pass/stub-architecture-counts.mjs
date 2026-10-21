// STUB of scripts/architecture-counts.mjs for the skill-lint fixture rig. Each block copies the REAL
// emitter line shape (architecture-counts.mjs :1104, :1135, :1151, :1153, :1154, :1163) so the probe
// measures skill-lint's parser against the sub-process's actual vocabulary.
const mode = process.env.STUB_MODE || "clean";
const cmd = process.argv[2] || "check";
if (cmd === "list") {
  if (mode === "list-crash") { console.error("TypeError: boom\n    at file:///stub.mjs:1:1"); process.exit(1); }
  if (mode === "list-renamed-key") { console.log(JSON.stringify({ skillCount: 107, distinctLessons: 1788 })); process.exit(0); }
  console.log(JSON.stringify({ skills: 107, distinctLessons: 1788, activeRecallHotTier: 34, metaSubcommands: 15 }));
  process.exit(0);
}
if (cmd === "check") {
  const blocks = {
    "clean": null,
    "count-drift": "COUNT + NARRATIVE DRIFTS (1):\n  Line 12: skill roster — claimed 100, actual 107",
    // The comparison record's banner drift uses the SAME template string as the doc drift (in architecture-counts.mjs),
    // and skill-lint's driftMatches (:868) runs over the whole stderr — so this one is PARSED, and mislabeled as
    // architecture.md drift.
    "banner-drift": "COMPARISON.md BANNER DRIFTS (1):\n  Line 7: skills banner — claimed 100, actual 107",
    "listing-count": "LISTING DRIFTS (1):\n  hooks: claimed 50, listed 51",
    "listing-missing": "LISTING DRIFTS (1):\n  hooks MISSING from listing: hooks/new-guard.sh",
    "listing-extra": "LISTING DRIFTS (1):\n  hooks EXTRA in listing: hooks/deleted-guard.sh",
    "appx-c": "APPENDIX C COVERAGE (1):\n  L# cited in body but missing from Appendix C: L7",
    "anchor-rot": "NARRATIVE ANCHOR ROT (1):\n  skills: every narrative matcher for this key matched ZERO sentences while architecture.md exists — the anchor sentence was likely reworded or removed. Rot here is otherwise SILENT (no match → no drift entry → a stale number is never re-checked). Re-anchor the matcher in PATTERNS, or retire the key from NARRATIVE_EXPECTED_KEYS if the doc deliberately dropped the claim.",
    "crash": "TypeError: Cannot read properties of undefined (reading 'match')\n    at file:///stub.mjs:9:3",
  };
  if (!(mode in blocks)) { console.error(`stub: unknown mode ${mode}`); process.exit(9); }
  const b = blocks[mode];
  if (b === null) { console.log("✅ clean"); process.exit(0); }
  console.error("⚠️  doc-count drift detected:\n\n" + b + "\n\nRun 'node scripts/architecture-counts.mjs fix' to apply ≤5-LOC auto-fixes (drift only; listing + coverage + anchor rot surface as proposals).");
  process.exit(1);
}
console.error(`stub: unknown command ${cmd}`); process.exit(2);
