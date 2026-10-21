#!/usr/bin/env bash
# PreToolUse(Bash) hook — HARD-BLOCK (exit 2) pushes + CI-triggering commands
# unless the owner has explicitly approved THIS action (ALLOW_PUSH=1 prefix).
#
# HARD RULE: never `git push` or trigger a CI/Actions run without explicit
# per-action approval.
# Context: a single session once burned most of the code host's monthly CI allowance via
# repeated direct pushes + a Dependabot rebase/recreate/auto-merge cascade. CI here is
# the FULL Tests suite, billed per run; deploy is CI-gated. So each unapproved push
# costs real money + risks blocking deploys.
#
# MODE: HARD-BLOCK (exit 2). This is a deliberate speed-bump, not an absolute lock —
# when the owner approves, re-run the command with an `ALLOW_PUSH=1 ` prefix and it
# passes. The point is to make every push/CI-trigger a CONSCIOUS, owner-sanctioned
# 2-step action instead of a reflex. Mirrors block-dangerous.sh's deny protocol.
#
# BLOCKS (only these — everything else exits 0 SILENT, zero noise on normal work):
#   - git push                       (any push to a CI-enabled branch)
#   - gh pr merge                    (post-merge CI on main)
#   - gh pr create / gh pr reopen    (opens PR -> PR CI run)
#   - gh pr comment                  (the common use here is `@dependabot rebase/merge`,
#                                     each of which fires a fresh CI run; grep can't see
#                                     inside a quoted --body, so the whole verb is gated)
#   - gh run rerun                   (re-runs a workflow)
#   - gh workflow run                (manual dispatch)
#
# Does NOT block (free / read-only — silent pass): git status|log|diff|fetch|add|commit|
# checkout|rebase (local), gh pr view|list|checks|diff, gh run view|list, npm, etc.
#
# Escape: prefix the command with `ALLOW_PUSH=1 ` (e.g. `ALLOW_PUSH=1 git push origin main`)
# AFTER the owner says go. The hook sees the marker in the command string and passes.

set -u

input=$(cat 2>/dev/null || echo "{}")

# Extract the bash command string (grep — no jq dep, matches block-dangerous.sh).
cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')

[[ -z "$cmd" ]] && exit 0

# Approval escape — owner has sanctioned THIS action.
if echo "$cmd" | grep -qE '\bALLOW_PUSH=1\b'; then
  exit 0
fi

normalized=$(echo "$cmd" | tr -s '[:space:]' ' ')
reason=""

if echo "$normalized" | grep -qE '\bgit[[:space:]]+push\b'; then
  reason="git push"
elif echo "$normalized" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
  reason="gh pr merge"
elif echo "$normalized" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|reopen)\b'; then
  reason="gh pr create/reopen (opens a PR -> CI run)"
elif echo "$normalized" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+comment\b'; then
  reason="gh pr comment (Dependabot rebase/merge triggers fire a CI run)"
elif echo "$normalized" | grep -qE '\bgh[[:space:]]+run[[:space:]]+rerun\b'; then
  reason="gh run rerun"
elif echo "$normalized" | grep -qE '\bgh[[:space:]]+workflow[[:space:]]+run\b'; then
  reason="gh workflow run"
fi

if [[ -n "$reason" ]]; then
  cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-push-without-approval.sh: '$reason' pushes to remote / triggers a billed CI run, and the HARD RULE is: no push or CI-trigger without explicit per-action approval.\n\nDo NOT silently bypass. Ask the owner to approve THIS specific push/action first. ONLY after they say go, re-run with an 'ALLOW_PUSH=1 ' prefix (e.g. 'ALLOW_PUSH=1 git push origin main'). Batch changes into ONE push. Local commits + free local verification (tsc/npm test/test:integration) need no approval."
  }
}
JSON
  exit 2
fi

exit 0
