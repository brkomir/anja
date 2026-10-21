// The expert agent <-> settings.json skillOverrides pairing — ONE home for the model-invoked set and
// the pairing predicate. Two readers: scripts/generate-expert-agents.mjs (both modes) and
// a unit test (which adds the harness-state and key-exists checks on top).
// Before this module each reader held its own copy of the set, tied only by a "mirror of" comment.

// Experts the model invokes through the Skill tool;
// a user-invocable-only skill cannot be invoked that way, so these must stay visible.
// None in this copy: add a name here when an expert is meant to be invoked by the model.
export const MODEL_INVOKED_EXPERTS = new Set([]);

/** Pairing violations, one string per violation; empty = in step. */
export function pairingViolations(overrides, agents) {
  const out = [];
  for (const a of agents) {
    if (!MODEL_INVOKED_EXPERTS.has(a) && overrides[a] !== "user-invocable-only") out.push(`expert agent not hidden: ${a}`);
  }
  for (const [h, v] of Object.entries(overrides)) {
    if (v !== "user-invocable-only") continue;
    if (MODEL_INVOKED_EXPERTS.has(h)) out.push(`model-invoked expert hidden: ${h}`);
    if (!agents.includes(h)) out.push(`hidden name is not an expert agent (a command skill?): ${h}`);
  }
  return out;
}
