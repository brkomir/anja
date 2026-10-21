#!/usr/bin/env bash
# run-changed-e2e.sh — compute affected e2e specs vs a base ref, forward to
# scripts/e2e-local.sh for always-isolated execution.
#
# Policy: we DON'T gate every commit on the full
# playwright suite (~5min), but any commit that adds or modifies an e2e spec
# MUST run that spec before merge. Also runs specs whose NAME TOKENS match a
# changed app/component/service/action path.
#
# SELECTION MODEL + KNOWN GAP: specs are selected
# by NAME-TOKEN match — the basename AND every directory segment of each changed path (a
# route's identity lives in its DIRECTORY: basename-only reduced a route's
# client.tsx to the skipped token `client`, so the gate could never select that route's
# own spec and shipped a prod regression CI caught post-deploy).
# This is deliberately NOT a reverse-dependency import graph: Playwright specs drive URLs,
# they do not import app code, so an import-graph walk from the specs would reach ~none of
# src/app/** — a reverse-dependency map here would be false coverage, not more coverage.
# RESIDUAL GAP (real, documented): a spec whose name shares NO token with any changed path
# (and which itself did not change) is NOT selected. CI runs no e2e on a dev push, so on that path
# nothing runs it until the promote PR's full CI run (this line said "CI's full
# post-push suite", which is false on dev). If this gap ships another regression, the next lever is a
# spec-declared route map (each spec names the routes it exercises), not an import graph.
# PROJECT: E2E_GATE_PROJECT (set by .githooks/pre-push to `desktop`: the push gate runs desktop only) is
# passed on as `--project=<name>`; mobile runs at the promote PR. Unset = every project, as before.
# Verify selection without running anything: E2E_SELECT_DRY_RUN=1 scripts/run-changed-e2e.sh <ref>
#
# 2026-05-19 refactor: previously this script ran playwright against the
# existing dev `.next` build (a ~5s fast path). That
# pattern bounced on the env-safety guard in nearly every audit-check invocation
# because the default dev environment is not isolated. The "5s fast loop"
# never actually fired in practice. New flow forwards to e2e-local.sh which
# uses a cached .next-e2e/ build (~25s steady-state, ~90s on cold cache)
# against mock auth + Docker DB: a single isolated workflow, which needs no
# env-safety guard.
#
# Usage:
#   scripts/run-changed-e2e.sh             # diff vs the shared baseline (origin/dev once it exists, else origin/main)
#   scripts/run-changed-e2e.sh HEAD~1      # diff vs specific ref
#   scripts/run-changed-e2e.sh --all       # full suite via e2e-local.sh
#
# Exits 0 if no relevant changes or all matching specs pass.
# Exits non-zero if any changed spec fails — blocks the merge.

set -euo pipefail

cd "$(dirname "$0")/.."

# SHARED BASELINE (branching policy): origin/dev once it
# exists (the branch every session works on), origin/main before the cutover. Resolved, never assumed.
SHARED_BASELINE="origin/main"
git rev-parse --verify --quiet 'origin/dev^{commit}' >/dev/null 2>&1 && SHARED_BASELINE="origin/dev"
BASE_REF="${1:-$SHARED_BASELINE}"
if [[ "$BASE_REF" == "--all" ]]; then
  echo "→ running full playwright suite via e2e-local.sh (escape hatch)"
  exec scripts/e2e-local.sh
fi

# Fetch the origin branch silently if that's the base. Skip if it's a local ref.
if [[ "$BASE_REF" == "origin/"* ]]; then
  git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true
fi

# An unresolvable base used to read as "no changed files", rc 0 — a typo'd ref looked like a
# clean skip (pre-push resolves its own base before calling).
if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "✗ run-changed-e2e: base ref '$BASE_REF' does not resolve to a commit — nothing selected, nothing run." >&2
  exit 2
fi

CHANGED_FILES="$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || git diff --name-only "$BASE_REF" 2>/dev/null || true)"
if [[ -z "$CHANGED_FILES" ]]; then
  # In dry-run mode stdout carries the spec list ONLY, so this notice goes to stderr there.
  if [[ "${E2E_SELECT_DRY_RUN:-0}" == "1" ]]; then
    echo "→ dry run: no changed files vs $BASE_REF — 0 specs selected" >&2
  else
    echo "→ no changed files vs $BASE_REF — skipping"
  fi
  exit 0
fi
N_CHANGED="$(printf '%s\n' "$CHANGED_FILES" | grep -c .)"

# Collect e2e specs to run:
#   (a) any changed *.spec.ts under tests/e2e/
#   (b) spec files whose name token appears in a changed src/app, src/components,
#       src/services, or src/actions path (heuristic best-effort, tolerates
#       false positives). Services + actions added 2026-05-18 after a second
#       e2e regression where touching one service module triggered ZERO
#       indirect-spec discovery despite several routes all depending on it.
# A DELETED spec is in the diff but not on disk; passing it to Playwright throws `No tests found` and
# reds a healthy deletion-only push. Keep only specs that exist in the working tree.
DIRECT_SPECS="$(echo "$CHANGED_FILES" | grep -E '^tests/e2e/.*\.spec\.ts$' | while IFS= read -r s; do if [[ -f "$s" ]]; then echo "$s"; fi; done || true)"

INDIRECT_SPECS=""
# HERE-STRING, never `echo "$CHANGED_FILES" | grep -q`: under `pipefail` grep -q exits at its first
# match, echo dies of SIGPIPE writing the rest, and the pipeline reads as NO match. It needs a list
# larger than the pipe buffer, roughly 1,000+ paths (match first: 62 KB never missed, 83 KB always
# did); on a ~3,000-file push it skipped every name-token match and printed "0 specs selected".
# The pre-push hook already used here-strings for the same predicate; this copy had been missed.
if grep -qE '^src/(app|components|services|actions)/' <<< "$CHANGED_FILES"; then
  for f in $(echo "$CHANGED_FILES" | grep -E '^src/(app|components|services|actions)/'); do
    tokens=""
    base="$(basename "$f" .tsx)"
    base="${base%.ts}"
    # Skip trivial basenames that would match everything.
    if [[ ${#base} -ge 4 && "$base" != "page" && "$base" != "layout" && "$base" != "client" && "$base" != "route" && "$base" != "index" ]]; then
      tokens="$base"
    fi
    for tok in $tokens; do
      matches="$(grep -rlE "\\b${tok}\\b" tests/e2e --include='*.spec.ts' 2>/dev/null || true)"
      INDIRECT_SPECS="${INDIRECT_SPECS}${matches}
"
    done
    # PATH-SEGMENT tokens: the App Router names ~152 files page/layout/client/
    # error/loading — their route identity is the directory. (app) -> app (then <4, skipped
    # naturally); [id] -> id (skipped); `locale` skipped explicitly. Segment tokens match
    # spec FILENAMES, not content: specs are NAMED after the route/flow they exercise, while
    # a route word in spec CONTENT is usually a copy assertion — measured on the
    # incident file, content-matching its route word selected 19 specs; filename-matching
    # selects exactly the one spec the gate missed.
    rel="${f#src/}"; rel="${rel#*/}"          # drop src/<category>/
    dir="$(dirname "$rel")"
    if [[ "$dir" != "." ]]; then
      IFS='/' read -ra _segs <<< "$dir"
      for seg in "${_segs[@]}"; do
        seg="${seg//[()\[\]]/}"
        [[ ${#seg} -lt 4 ]] && continue
        case "$seg" in page|layout|client|route|index|locale) continue;; esac
        seg_matches="$(ls tests/e2e/*.spec.ts 2>/dev/null | grep -E "(^|[-/])${seg}[-.]" || true)"
        INDIRECT_SPECS="${INDIRECT_SPECS}${seg_matches}
"
      done
    fi
  done
fi

TO_RUN="$(printf '%s\n%s\n' "$DIRECT_SPECS" "$INDIRECT_SPECS" | sort -u | grep -v '^$' || true)"

# Selection-only mode: print the computed spec set and exit (verification + CI-forensics).
if [[ "${E2E_SELECT_DRY_RUN:-0}" == "1" ]]; then
  # An empty selection used to print a bare blank line, indistinguishable from a run that printed
  # nothing at all (read as a void reading and re-probed twice, 2026-09-28). Say so, on stderr, so
  # stdout stays the spec list and nothing else.
  if [[ -z "$TO_RUN" ]]; then
    # "No e2e-relevant changes" named a cause the script never measured: selection is
    # by name token, so a relevant change can select nothing — see the header's RESIDUAL GAP.
    echo "→ dry run: 0 specs selected vs $BASE_REF ($N_CHANGED changed files; none name-matched a spec — see the header's RESIDUAL GAP)" >&2
  else
    echo "$TO_RUN"
  fi
  exit 0
fi

if [[ -z "$TO_RUN" ]]; then
  echo "→ 0 specs selected vs $BASE_REF ($N_CHANGED changed files; none name-matched a spec — see the header's RESIDUAL GAP) — skipping"
  exit 0
fi

echo "→ forwarding affected e2e specs to e2e-local.sh${E2E_GATE_PROJECT:+ (project: $E2E_GATE_PROJECT only)}:"
echo "$TO_RUN" | sed 's/^/   /'
echo

# shellcheck disable=SC2086
exec scripts/e2e-local.sh ${E2E_GATE_PROJECT:+--project=$E2E_GATE_PROJECT} $TO_RUN
