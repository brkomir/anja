# Prompt Patterns

Reusable patterns for system prompt design, version management, and production prompt operations.

## Pattern 1: The Calibration Anchor

When asking a model to score or rate, provide explicit anchors so scores are meaningful and consistent.

**Problem:** Without anchors, models cluster scores in a comfortable range (6-8 out of 10) regardless of quality.

**Solution:**

```
SCORING RULES:
- Scores range from 0.0 to 10.0, rounded to one decimal.
- Be calibrated: a score of 7+ should mean genuinely strong work.
- Do not cluster all scores between 6-8. Use the full range honestly.

TIER ANCHORS:
  A  → 9.0-10.0 (portfolio/competition candidate)
  B+ → 7.5-8.4  (almost portfolio quality)
  B  → 6.8-7.4  (strong supporting work)
  C+ → 5.0-5.9  (has a redeeming quality but practice-level)
  C  → below 5.0 (practice image — extract lesson, move on)

CONSISTENCY:
- The score MUST be consistent with the assigned tier.
- If tier is B+ but score is 6.5, one of them is wrong. Fix it.
```

**Why it works:** Anchors create reference points the model can compare against. Without them, the model defaults to "safe" middle-range scores.

## Pattern 2: The Coordinate Verification

When requesting spatial output (bounding boxes, coordinates, crop regions), build in self-verification.

**Problem:** Models are overconfident about spatial reasoning and produce coordinates that don't match their descriptions.

**Solution:**

```
SUBJECT SAFETY — before outputting a crop region:
1. Trace the full silhouette of the main subject, including extremities
2. Confirm the crop contains the ENTIRE subject PLUS 5% breathing room
3. If ANY part of the subject would be within 5% of the crop edge,
   widen the region or set needed to false
4. When in doubt, do NOT crop

COORDINATE-TEXT CONSISTENCY:
- If direction says "trim left": x must be > 0
- If direction says "trim right": x+w must be < 1.0
- If direction says "trim top": y must be > 0
- Verify coordinates match the verbal description before outputting
```

**Why it works:** Forcing the model to "think through" the verification catches errors before they reach the output.

## Pattern 3: The Explicit Null Semantics

Every nullable field should have documented meaning for both states.

**Problem:** Without explicit semantics, the model randomly returns null or empty strings based on attention patterns, not meaning.

**Solution:**

```
potential_reason:
- string: explains what fundamentally limits potential
  (composition, capture-time limitation)
- null: nothing limits potential beyond the current bottleneck
  → Return null when the only thing between current score
    and potential is the identified bottleneck fix.

bottleneck_region:
- object: {x, y, w, h, label} highlighting where the issue is visible
- null: ONLY when the bottleneck is purely conceptual or global
  with no localizable region (e.g. "edit-discipline", "concept")
  → Set to null rarely. Most bottlenecks have a visible location.
```

**Why it works:** Explicit null semantics eliminate ambiguity and make model behavior predictable.

## Pattern 4: The Anti-Loop Guard

For iterative systems where users submit multiple versions, prevent the AI from creating infinite improvement loops.

**Problem:** Without guards, the model always finds something to fix, even when the image is excellent. Users get stuck in an endless editing cycle.

**Solution:**

```
STOP CONDITION CHECKS:
Always evaluate these four conditions:
1. artistic_above_threshold: Is artistic score >= 8.8?
2. no_structural_flaws: Are there no major composition/exposure/focus flaws?
3. lane_consistency_above_85: Is lane consistency >= 85%?
4. diminishing_returns: Would further editing yield only marginal improvement?

When all four are true, stop_editing MUST be true.

"Move on" is a valid and useful answer. Not every image deserves more work.
Edit restraint is a feature. If further editing will not meaningfully improve
the image, say stop.
```

**Why it works:** Explicit stop conditions prevent the model from being "helpful" by always suggesting more edits. The product value includes knowing when to stop.

## Pattern 5: The Editor-Specific Translation

When output needs to be actionable across different tools, structure the translation explicitly.

**Problem:** Generic editing advice ("reduce highlights") means different things in different software. Slider names, ranges, and concepts vary.

**Solution:**

```
Each cluster must include a "software" object with specific adjustments
for all 3 editors, scoped to that cluster's area:

- Lightroom: Use Adobe Lightroom Classic slider names
  (e.g. "Highlights: -10 to -20", "Texture: +8 to +15 (subject mask)")
- Capture One: Use Capture One Pro slider/tool names
  (e.g. "High Dynamic Range: -0.3 to -0.6")
- Darktable: Use Darktable module names
  (e.g. "filmic rgb: white relative exposure -0.3 to -0.5EV")

Use VALUE RANGES, not exact values. The AI cannot see the histogram
or raw data. Ranges give a starting window to fine-tune by eye.
```

**Why it works:** Naming the exact tool/slider in each software makes the output immediately actionable. Ranges acknowledge uncertainty honestly.

## Pattern 6: The Content Safety Gate

For user-generated content that may be published, include a safety classification.

**Problem:** Publishing every upload without screening creates moderation risk.

**Solution:**

```
CONTENT SAFETY (boolean flag):
- Set to true if appropriate for public display
- Set to false if the content falls in any category on your
  explicit disallowed-content list
- When in doubt, err on the side of false
- This flag gates whether the user can publish the content
- Still provide the full critique regardless of this flag
```

**Why it works:** Binary classification with explicit criteria and a conservative default. Separating the safety gate from the critique means all users get value regardless.

## Prompt Version Management

### Versioning Strategy

```
v1.0 — Initial release
v1.1 — Bug fix (scoring consistency)
v1.2 — Minor addition (new field)
v2.0 — Major rewrite (new architecture)
```

Track versions with a constant exported alongside the prompt:

```typescript
export const PROMPT_VERSION = "v2.1";
```

Log the version with every API call so you can correlate output quality changes with prompt changes.

### Change Log Discipline

Before any prompt change:
1. Document what you're changing and why
2. Run the eval set on the CURRENT prompt (baseline)
3. Make the change
4. Run the eval set on the NEW prompt
5. Compare all dimensions
6. Only ship if no regressions

### Rollback Plan

Always keep the previous version accessible. If production quality degrades:
1. Check if a prompt change was deployed recently
2. Roll back to the previous version
3. Investigate with the eval set

## Production Prompt Operations

### Monitoring

| What to Monitor | Why | Alert Threshold |
|----------------|-----|-----------------|
| JSON parse failure rate | Schema compliance degrading | >1% of requests |
| Average output token count | Cost and quality signal | >20% change from baseline |
| Retry rate | First attempt failing validation | >5% of requests |
| Score distribution | Calibration drift | >80% of scores in any 2-point range |
| Response latency (p95) | User experience | >10 seconds |

### Caching Strategy

```
System prompt + image detail settings = cache key prefix

With prompt caching enabled:
- First request: full price on system prompt tokens
- Subsequent requests: 10% of normal price (90% savings)
- Cache is per-model, per-prompt-prefix

Optimization: Keep the system prompt at the TOP, identical across
all requests. Variable content (lane, user context) goes AFTER.
```

### Error Handling

```typescript
const MAX_RETRIES = 1;

async function callModel(input) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create({ ... });
    
    try {
      const parsed = schema.parse(JSON.parse(response.content));
      return parsed; // Valid output
    } catch (parseError) {
      if (attempt === MAX_RETRIES) {
        throw new Error("Failed to get valid output after retries");
      }
      // Retry with same input — model may produce valid output
    }
  }
}
```

**Keep MAX_RETRIES low (1).** If the prompt + schema are well-designed, retries should be rare (<2%). If you need many retries, fix the prompt, don't increase retries.

## Prompt Compression Checklist

When a system prompt exceeds ~3,000 tokens, audit it:

- [ ] Are any instructions repeated in different words? → Merge
- [ ] Are there paragraphs that could be tables? → Convert
- [ ] Are there rules the model already knows? ("Write valid JSON") → Remove
- [ ] Are there edge cases that never actually occur? → Remove
- [ ] Can any section be moved to the user message (varies per request)? → Move
- [ ] Can any section be moved to few-shot examples? → Move
- [ ] After cutting, does the eval set still pass? → Verify

**Target:** System prompts under 2,500 tokens for cost efficiency. Longer is acceptable if every token earns its place.
