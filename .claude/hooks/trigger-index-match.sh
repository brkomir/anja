#!/usr/bin/env bash
# trigger-index-match — fires on UserPromptSubmit. Greps the user prompt
# against a curated set of "hot" trigger phrases that map to project-memory
# entries; surfaces matching entries to stderr as advisory context BEFORE
# the model composes its response.
#
# Closes the class: memory was loaded but not consulted at the
# moment of composition. The system already loads MEMORY.md into context,
# but rules drift to the bottom of long sessions. This hook surfaces the
# most relevant entries by keyword match against the current prompt.
#
# Currently WARN-MODE: prints advisories, exits 0 (never blocks).
# Promote to higher-signal output (or block via exit-code 2 on UserPromptSubmit)
# only after observing 10+ sessions with <5% false-positive rate.
#
# Source of truth: keyword→memory mapping is in this script, because
# trigger-index "If about to..." phrasing is optimized for human reading,
# not keyword grep. Keep this in sync with the Trigger-Index rows in
# .claude/orchestrator/conventions.md.
#
# Smoke-tested via scripts/smoke-test-hooks.sh (FIRE pairs + SAFE pair).

set -u  # no -e; logging must never fail the user-prompt path

# Read the prompt from stdin (Claude Code passes UserPromptSubmit JSON)
INPUT="$(cat)"
# A keep-warm ping turn (prompt starts '[keep-warm]', .claude/hooks/keep-warm-gate.py) is a harness timer,
# not the owner: inject nothing, so the ping stays one cheap read.
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"[[:space:]]*\[keep-warm\]' && exit 0

# Extract the `prompt` field. Prefer jq; fallback to grep.
if command -v jq >/dev/null 2>&1; then
  PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
else
  # Fallback: best-effort grep for the prompt field. A newline inside the prompt reads as a space here, so a
  # trigger word split across lines still matches; with jq a typed literal backslash-n before the word stays
  # quiet, without jq it fires (the suite's no-jq multi-line arm pins the difference).
  PROMPT="$(printf '%s' "$INPUT" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\(.*\)"$/\1/; s/\\n/ /g')"
fi

# Empty prompt (e.g., command-only invocation) → silent exit.
if [[ -z "${PROMPT:-}" ]]; then
  exit 0
fi

# Lowercase the prompt for case-insensitive substring match.
PROMPT_LC="$(printf '%s' "$PROMPT" | tr '[:upper:]' '[:lower:]')"

# ---- Trigger map ----
# Parallel arrays: TRIGGER_PATTERNS[i] is matched against $PROMPT_LC; if it
# hits, ADVISORIES[i] is emitted to stderr. Pipe-as-field-separator avoided
# because regex alternation uses `|` inside many patterns.
#
# Keep patterns narrow — high precision over recall. False positives at the
# UserPromptSubmit boundary are expensive (every prompt pays).
#
# Sync target: the Trigger-Index rows in .claude/orchestrator/conventions.md.

declare -a TRIGGER_PATTERNS=(
  # Git safety (parallel-session danger)
  'git stash'
  'git add -a'
  'git add \.'

  # Migrations
  'apply.*migration'
  'apply.*staging'
  'apply.*(prod|production)'
  'run.*migration'

  # Translation
  'translate.*(de|es|fr|hi|it|ja|ko|pl|pt|sr|tr)'
  'localize'

  # Testing wrapper discipline
  'npx vitest'
  'integration test'
  'playwright'
  'run e2e'

  # Defer discipline
  'defer.*post.launch'
  'monitor.*post.launch'

  # Speculation guardrails
  'stack trace'
  'looks like.*error'

  # Recommend AND execute
  'shall i proceed'
  'should i proceed'

  # Domain-specific gotchas
  'auth.*email template'

  # Meta-system signals
  '/meta'
  '[0-9]+ (hour|hr|day|min)'

  # Peer-state assertion — fires when the prompt asks about peer/session liveness or ownership
  'which (peer|session)|(the )?peer[^.]{0,25}(edit|own|dirty|wrapp|activ|live|broke)|who.{0,15}editing'

  # Owner cannot track the work. Fires on the prompt text itself, on the one
  # event that precedes composition: no wired event sees assistant prose before
  # the prompt's author does, so a prose-side predicate cannot prevent this (one
  # was built, measured and refuted). ⚠️ Recall is FITTED to a few known
  # phrasings; a new phrasing WILL be missed. Measured 2026-10-09 over 10,169
  # typed prompts of one user on the machine it was built on: 6 fires, 6 true,
  # 0 false. An earlier form of the last-but-one alternative matched "closing it"
  # three times; the boundary before "losing" is what removed that, and the same
  # boundary before "can't" keeps "a significant track record" quiet (synthetic;
  # no fire changed on the corpus).
  "(^|[^a-z])can.?t (follow|track)|(don.?t|not) follow(ing)? (you|what)|hard time (to )?follow|(^|[^a-z])losing (it|track)|no idea what.{0,20}going on"
)

declare -a ADVISORIES=(
  # Git safety
  '→ NEVER git stash with parallel sessions active — use `git show HEAD:path` or `git add -p`.'
  '→ NEVER `git add -A` — list files explicitly. No safety net against secrets, binaries, parallel-session WIP.'
  '→ `git add .` has the same risks as `git add -A` — list files explicitly.'

  # Migrations
  '→ /migration skill is canonical. Do NOT use psql or the database platform CLI directly. Verify integration tests still pass after.'
  '→ if this is a DB migration, invoke /migration skill (not direct psql).'
  '→ if this is a DB migration, invoke /migration skill (not direct psql).'
  '→ /migration skill is canonical for applying the repo'\''s SQL migration files.'

  # Translation
  '→ NEW keys must be TRANSLATED into every non-EN locale (English-placeholder policy RETIRED).'
  '→ translate new keys into every locale — NOT English placeholders (policy flipped).'

  # Testing
  '→ integration tests use `npm run test:integration` (auto Docker), not bare npx vitest.'
  '→ use `npm run test:integration`. Parallel sessions: scripts/integration-test.sh picks port 5433-5437 per session.'
  '→ e2e uses `./scripts/e2e-local.sh` (DB 5495-5499 + Next 3100-3104 per session). Bare `npx playwright` will collide with parallel sessions.'
  '→ `./scripts/e2e-local.sh <pattern>` is the canonical entry point.'

  # Defer discipline
  '→ every defer needs LOC estimate + trigger condition + valid reason. "post-launch" alone is not a trigger.'
  '→ apply defer discipline to monitor items; present effort estimate.'

  # Speculation guardrails
  '→ read the actual code path before speculating from stack trace symptoms.'
  '→ do NOT say "looks like Y" without reading the code. Verify first.'

  # Recommend AND execute
  '→ for <15-line work, just do it and show what you did — don'\''t present a table and wait.'
  '→ for <15-line work, just do it and show what you did — don'\''t present a table and wait.'

  # Domain-specific
  '→ in auth email templates, link to the app'\''s own auth-callback route carrying the token hash (server-side PKCE flow), NOT the provider'\''s default confirmation URL.'

  # Meta
  '→ prefix /meta response with bold `[meta]` marker for visual disambiguation.'
  '→ avoid human-time estimates in recommendations — use LOC / file-count / tool-call count instead.'

  # Peer-state assertion
  '→ peer-state claim risk. An uncommitted change has NO git author (could be MINE); an EARLIER-TURN scan is STALE (peers rotate). Re-run `git status` + `/peers` FRESH this turn before asserting any peer liveness/ownership, or say "unattributable".'

  # Owner cannot track the work
  '→ Do NOT reach first for a clearer restatement — it can be WRONG, because the confusion may be MINE, heard as the owner'\''s. ASK WHAT THE CORRECTION STREAM IS COVERING FOR: print the two things you believe you are comparing, AT SOURCE, side by side (a lever once read as dead while the two runs used DIFFERENT PROMPTS). Then state ONE current-truth paragraph: what is true NOW, what the owner should DO, and "I do not know X" for the rest — an "I do not know" is closable, a hedge is not. Say a correction ONLY if the owner could have ACTED on the wrong version.'
)

# Invariant: TRIGGER_PATTERNS and ADVISORIES have the same length.
# Verify at runtime to catch maintenance drift.
if [[ ${#TRIGGER_PATTERNS[@]} -ne ${#ADVISORIES[@]} ]]; then
  echo "→ trigger-index-match: INTERNAL ERROR — patterns/advisories array length mismatch (${#TRIGGER_PATTERNS[@]} vs ${#ADVISORIES[@]})" >&2
  exit 0
fi

# ---- Match loop ----
HITS=()
for i in "${!TRIGGER_PATTERNS[@]}"; do
  pattern="${TRIGGER_PATTERNS[$i]}"
  advisory="${ADVISORIES[$i]}"
  if printf '%s' "$PROMPT_LC" | grep -qE "$pattern"; then
    HITS+=("$advisory")
  fi
done

# Deduplicate (same advisory may match via multiple patterns)
if [[ ${#HITS[@]} -eq 0 ]]; then
  exit 0
fi

# Emit advisory block to stderr — the HUMAN/terminal channel. Kept unchanged.
{
  echo ""
  echo "→ trigger-index-match: ${#HITS[@]} relevant memory entry/entries for this prompt"
  printf "  %s\n" "${HITS[@]}" | sort -u
  echo ""
} >&2

# ...AND on the MODEL channel, which is a DIFFERENT channel and the reason this
# block exists. Bare stderr does NOT reach the model: MEASURED on PreToolUse
# via a change-one-variable A/B — warn fired and delivered zero text to both the
# orchestrator and a dispatched sub-agent, while the block arm delivered its
# reason verbatim. `additionalContext` DOES reach on UserPromptSubmit: the two
# sibling hooks on this same event (band-o-inject.sh, mail-listen-arm-reminder.sh)
# both land in context that way on every turn. Until this line, this hook was
# the ONLY stderr-only UserPromptSubmit hook — advertised by
# .claude/rules/active-recall.md as one of "two layers, both warn-mode,
# complementary" while being, on the model plane, a logger.
#
# Payload goes via a TEMP FILE — not a pipe, not an env var (band-o-inject.sh
# carries the full rationale: `python3 - <<HEREDOC` takes the PROGRAM from stdin
# so a piped payload is unreachable, and macOS caps env+args at ~1 MB).
# `set -u` only, no `-e`, so a failure here cannot break the user-prompt path:
# worst case stdout stays empty and the stderr block above is unchanged.
_TIM_PAYLOAD="$(mktemp)"
{
  echo "→ trigger-index-match: ${#HITS[@]} relevant memory entry/entries for this prompt"
  printf "  %s\n" "${HITS[@]}" | sort -u
} > "$_TIM_PAYLOAD"
python3 -c 'import json,sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
# 10,000-char additionalContext harness cap (band-o-inject.sh EMIT_CLAMP_ABOVE rationale):
# an over-cap payload SPILLS to a file + ~2 KB preview, so a clamp IS the delivery
# guarantee. 9,500 leaves room for the harness envelope.
if len(t) > 9500:
    t = t[:9500] + "\n[trigger-index-match: payload clamped at 9,500 chars — 10,000-char additionalContext cap]"
print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": t}}))' "$_TIM_PAYLOAD"
rm -f "$_TIM_PAYLOAD"

exit 0
