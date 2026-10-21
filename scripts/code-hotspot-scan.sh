#!/usr/bin/env bash
# code-hotspot-scan.sh — emit corpus hotspot signals for /expert-review code-corpus slice mode.
#
# 5 signals:
#   1. LOC × churn matrix (90d) — high LOC + high churn = refactor candidate;
#      high LOC + low churn = acceptable god-file
#   2. Coupling — files imported by >20 callers
#   3. Server actions (src/actions/**) without sibling test file
#   4. Schema-vs-Drizzle drift sentinel placeholder
#   5. Dependency staleness (semver-major behind only — minor/patch is noise)
#
# Output: human-readable report (default) or JSON (--json flag).
# Invocable directly OR from any skill (uncle-bob, /expert-review --code-corpus).
#
# Usage:
#   ./scripts/code-hotspot-scan.sh             # human-readable
#   ./scripts/code-hotspot-scan.sh --json       # JSON for skill briefing

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

JSON_MODE=0
if [[ "${1:-}" == "--json" ]]; then
  JSON_MODE=1
fi

emit() { [[ $JSON_MODE -eq 0 ]] && echo "$@" || true; }
emit_h() { [[ $JSON_MODE -eq 0 ]] && echo "## $*" || true; }

emit_h "code-hotspot-scan.sh — corpus signals as of $(date +%Y-%m-%d)"
emit ""

# 1. LOC × churn matrix — top 12 files by LOC, with 90d churn count
emit_h "1. LOC × churn matrix (top 12 by LOC, with 90-day commit churn)"
emit ""
emit "| LOC | 90d commits | File |"
emit "|---|---|---|"
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" \
  | xargs wc -l 2>/dev/null \
  | sort -rn \
  | head -13 \
  | tail -12 \
  | while read -r loc file; do
    if [[ -n "$file" && "$file" != "total" ]]; then
      churn=$(git log --oneline --since="90 days ago" -- "$file" 2>/dev/null | wc -l | tr -d ' ')
      emit "| $loc | $churn | $file |"
    fi
  done
emit ""

# 2. Coupling — files imported by >20 callers
emit_h "2. Coupling hotspots (imported by >20 distinct callers)"
emit ""
emit "| Callers | Import target |"
emit "|---|---|"
{
  grep -rhoE 'from "@/[^"]+"' src/ --include="*.ts" --include="*.tsx" 2>/dev/null \
    | sed 's/from "//' | sed 's/"//' \
    | sort | uniq -c | sort -rn | head -20 \
    | while read -r count import_path; do
      if [[ "$count" -gt 20 ]]; then
        emit "| $count | $import_path |"
      fi
    done
} || true
emit ""

# 3. Server actions without sibling test
emit_h "3. Server actions in src/actions/ without a sibling test"
emit ""
emit "(Manual check — does each src/actions/X.ts have a tests/**/X.test.ts?)"
ls src/actions/ 2>/dev/null | grep -E "\.ts$" | while read -r action_file; do
  base="${action_file%.ts}"
  if ! find tests -name "${base}.test.ts" -o -name "${base}.test.tsx" 2>/dev/null | grep -q .; then
    emit "- src/actions/$action_file"
  fi
done
emit ""

# 4. Schema-vs-Drizzle drift placeholder
emit_h "4. Schema drift sentinel (placeholder)"
emit ""
emit "Implementation pending: cross-reference latest supabase/migrations/*.sql"
emit "ALTER TABLE statements against src/db/schema.ts Drizzle declarations."
emit ""

# 5. Dependency staleness — semver-major behind only
emit_h "5. Dependency staleness (semver-major behind only)"
emit ""
if command -v npm >/dev/null 2>&1; then
  npm outdated --json 2>/dev/null | \
    node -e 'const data = JSON.parse(require("fs").readFileSync(0, "utf-8") || "{}");
      const major = Object.entries(data).filter(([k, v]) => {
        const cur = (v.current || "").split(".")[0];
        const latest = (v.latest || "").split(".")[0];
        return cur && latest && cur !== latest;
      });
      if (major.length === 0) { console.log("(no semver-major drift detected)"); }
      else {
        console.log("| package | current | latest |");
        console.log("|---|---|---|");
        major.forEach(([k, v]) => console.log(`| ${k} | ${v.current} | ${v.latest} |`));
      }' 2>/dev/null || emit "(npm outdated parse failed — install npm or check Node version)"
else
  emit "(npm not available — skipping dependency staleness scan)"
fi
emit ""

emit_h "Note for /expert-review code-corpus slice consults"
emit ""
emit "This script is informational, not enforcement. Output goes to synthesis"
emit "context, NOT to the tracker — promotion to the tracker requires explicit owner"
emit "decision per finding."
emit ""
emit "Peer-session check: if any file listed above is being actively modified in"
emit "another session (parallel-session-scan.py output), defer refactor discussion"
emit "for that file until peer commits land."
