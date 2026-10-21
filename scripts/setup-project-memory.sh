#!/usr/bin/env bash
# Symlink Claude Code's per-project auto-memory location to the in-repo project-memory directory.
#
# Why: Claude Code stores per-project memory at ~/.claude/projects/<key>/memory/ by default
# (key derived from absolute repo path). That puts knowledge OUTSIDE the repo, which means it
# doesn't version-control, doesn't survive across machines, and can't be reviewed via PRs.
#
# This script makes the repo's `.claude/project-memory/` the source of truth. Claude Code's
# harness keeps reading from its expected absolute path; the symlink redirects to the repo.
#
# Idempotent — safe to re-run.
#
# Usage: ./scripts/setup-project-memory.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The MAIN checkout, the one the key below names: run from a linked worktree, the symlink must still
# target the main repository's project-memory, never the worktree's copy, which goes when it does.
COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(dirname "$COMMON_DIR")"
REPO_MEMORY="$REPO_ROOT/.claude/project-memory"

# The harness-expected key for the MAIN checkout (/srv/work/my.repo -> -srv-work-my-repo; a linked
# worktree resolves to its main repository), from the repo's ONE port of the harness's naming —
# scripts/lib/project-key.mjs (per UTF-16 unit, the over-200 suffix) — never re-derived here.
KEY="$(cd "$REPO_ROOT" && node scripts/lib/project-key.mjs --key)"
HARNESS_DIR="$HOME/.claude/projects/$KEY"
HARNESS_MEMORY="$HARNESS_DIR/memory"

echo "Repo memory:    $REPO_MEMORY"
echo "Harness path:   $HARNESS_MEMORY"

if [ ! -d "$REPO_MEMORY" ]; then
  echo "ERROR: $REPO_MEMORY does not exist. The repo's project-memory directory must be present (it's tracked in git)." >&2
  exit 1
fi

mkdir -p "$HARNESS_DIR"

# Case 1: nothing at the harness path — create symlink
if [ ! -e "$HARNESS_MEMORY" ] && [ ! -L "$HARNESS_MEMORY" ]; then
  ln -s "$REPO_MEMORY" "$HARNESS_MEMORY"
  echo "OK: symlink created."
  exit 0
fi

# Case 2: already a symlink pointing at the repo — nothing to do
if [ -L "$HARNESS_MEMORY" ]; then
  CURRENT_TARGET="$(readlink "$HARNESS_MEMORY")"
  if [ "$CURRENT_TARGET" = "$REPO_MEMORY" ]; then
    echo "OK: symlink already correct."
    exit 0
  fi
  echo "ERROR: $HARNESS_MEMORY symlinks to $CURRENT_TARGET (not the repo). Resolve manually." >&2
  exit 1
fi

# Case 3: real directory at harness path — merge into repo + replace with symlink
if [ -d "$HARNESS_MEMORY" ]; then
  echo "Found real directory at $HARNESS_MEMORY. Merging into repo..."
  for f in "$HARNESS_MEMORY"/*; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    if [ -e "$REPO_MEMORY/$name" ]; then
      echo "  CONFLICT: $name exists in both — manual resolution needed."
      echo "  harness:  $f"
      echo "  repo:     $REPO_MEMORY/$name"
      exit 1
    fi
    mv "$f" "$REPO_MEMORY/"
    echo "  moved: $name"
  done
  rmdir "$HARNESS_MEMORY"
  ln -s "$REPO_MEMORY" "$HARNESS_MEMORY"
  echo "OK: directory merged into repo and replaced with symlink."
  exit 0
fi

echo "ERROR: unexpected state at $HARNESS_MEMORY (not symlink, not directory)." >&2
exit 1
