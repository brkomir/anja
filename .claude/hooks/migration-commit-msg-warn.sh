#!/usr/bin/env bash
# Pre-push hook: warn when a push includes a commit that touches
# supabase/migrations/NNNN_*.sql but the commit message does not declare
# environment application status.
#
# Warn-mode (NOT hard-block); promote to hard-block after 5 clean pushes
# without skip (per project convention — see components.md focus-visible entry).
#
# Codified 2026-05-23 after two feature waves shipped migrations
# without the "migrations NNNN staging+prod applied" notation.
# Triggered a false-alarm /orient warning that cost ~10 min to resolve via
# schema-probe script. There is no durable per-migration tracking table on
# either staging or prod (supabase_migrations.schema_migrations doesn't exist),
# so the commit message is the only audit trail.
#
# Prevents-NEW-class: migration-commit-message-audit-trail-missing
#
# Wire-up: invoked from .githooks/pre-push after CHANGED + BASE_REF computed.
# Args: $1 = BASE_REF (e.g. origin/main or remote SHA)

set -u

# SHARED BASELINE (branching policy): origin/dev once it
# exists, origin/main before the cutover. The pre-push hook passes its own BASE_REF as $1.
SHARED_BASELINE="origin/main"
git rev-parse --verify --quiet 'origin/dev^{commit}' >/dev/null 2>&1 && SHARED_BASELINE="origin/dev"
BASE_REF="${1:-$SHARED_BASELINE}"
# Run ledger: ONE row per run, clean included, so "5 clean pushes" has a denominator.
_w1_fire() { ( [ "${HOOK_SMOKE_EXEC:-0}" != 1 ] || [ -n "${HOOK_FIRES_LOG_DIR:-}" ] || exit 0; fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PREPUSH_MAIN_ROOT:-}}"
  fires_log migration-commit-msg-warn sid "${CLAUDE_CODE_SESSION_ID:-}" via "$([ -n "${PREPUSH_IN_SNAPSHOT:-}" ] && echo pre-push || echo manual)" outcome "$([ -n "${MISSING:-}${STALE:-}" ] && echo found || echo clean)" ) >/dev/null 2>&1 || true; }; trap _w1_fire EXIT

# Status phrase patterns — match the SPIRIT of the rule, not exact wording.
# Each commit touching a migration must include at least one of these tokens.
STATUS_REGEX='(staging\+prod applied|staging \+ prod applied|staging and prod applied|staging applied.*prod pending|prod pending|staging applied|created \(not yet applied\)|not yet applied|migration[s]? [0-9]+ .*pending application)'

# Find commits in this push range that touch a migration file.
COMMITS_WITH_MIGRATIONS=$(git log --format='%H' "$BASE_REF"..HEAD -- 'supabase/migrations/*.sql' 2>/dev/null || true)

if [ -z "$COMMITS_WITH_MIGRATIONS" ]; then
  exit 0
fi

MISSING=""
for sha in $COMMITS_WITH_MIGRATIONS; do
  MSG=$(git log -1 --format='%B' "$sha" 2>/dev/null || true)
  if ! echo "$MSG" | grep -qiE "$STATUS_REGEX"; then
    SHORT=$(git log -1 --format='%h %s' "$sha")
    FILES=$(git show --name-only --format='' "$sha" 2>/dev/null | grep -E '^supabase/migrations/[0-9]+_.*\.sql$' | sed 's|supabase/migrations/||' | tr '\n' ' ')
    MISSING="${MISSING}  ${SHORT}\n    migrations: ${FILES}\n"
  fi
done

if [ -n "$MISSING" ]; then
  echo "⚠ commit(s) include a migration but message lacks environment-application status:" >&2
  printf "%b" "$MISSING" >&2
  echo "  Required: append ONE of these phrases to the commit message before push:" >&2
  echo "    • migrations NNNN staging+prod applied" >&2
  echo "    • migrations NNNN staging applied (prod pending)" >&2
  echo "    • migrations NNNN created (not yet applied)" >&2
  echo "  Why: supabase_migrations.schema_migrations doesn't exist on either DB —" >&2
  echo "       commit message is the only audit trail (see .claude/rules/migrations.md)." >&2
  echo "  Fix: git commit --amend, or land a follow-up empty commit with the status note." >&2
  echo "" >&2
fi

# ── Layer 3 (2026-06-23): recent-migration un-notated batched nudge ──────────
# The per-commit check above catches a migration COMMITTED with no status phrase
# (Shape A). It is structurally blind to Shape B — a migration applied to both
# DBs whose recording commit is never made: applying is a DB write, so there is
# no push event at apply-time to gate, and the missing artifact is a commit that
# was never created. Five such drifts accumulated in ~12h on 2026-06-23. This
# batched, git-only nudge surfaces RECENT migrations lacking a staging+prod-applied
# notation ANYWHERE in history, so they don't pile up until /orient false-alarms.
# git can't tell applied-but-unrecorded from genuinely-unapplied — only the DB can —
# so it points at the authoritative classifier, scripts/migration-notation-reconcile.mjs
# (schema-probes both DBs; run at /orient or /wrap). Bounded to the last ~25 by number
# (won't list pre-notation-convention migrations). Warn-only. Phrase mirrors the reconcile.
ALL_NUMS=$(ls supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql 2>/dev/null \
  | sed -E 's|.*/([0-9]{4})_.*|\1|' | sort -u)
if [ -n "$ALL_NUMS" ]; then
  HIGHEST=$(echo "$ALL_NUMS" | tail -1)
  FLOOR=$((10#$HIGHEST - 25))
  SUBJECTS=$(git log --all --format='%s' 2>/dev/null || true)
  STALE=""
  for num in $ALL_NUMS; do
    [ "$((10#$num))" -lt "$FLOOR" ] && continue
    # both-env applied notation present for this number? (mirror the reconcile)
    if printf '%s\n' "$SUBJECTS" | grep -qiE "${num}.*(staging *\+ *prod|staging and prod).*(applied|in sync|synced)"; then
      continue
    fi
    # skip migrations FRESH in this push — the per-commit check above owns those.
    if git log --format='%H' "$BASE_REF"..HEAD -- "supabase/migrations/${num}_"*.sql 2>/dev/null | grep -q .; then
      continue
    fi
    STALE="${STALE} ${num}"
  done
  if [ -n "$STALE" ]; then
    echo "⚠ recent migration(s) lack a staging+prod-applied notation:${STALE}" >&2
    echo "  applied-but-unrecorded (Shape B) OR genuinely-unapplied — git can't tell." >&2
    echo "  resolve: node scripts/migration-notation-reconcile.mjs (schema-probes both DBs)." >&2
    echo "" >&2
  fi
fi

exit 0
