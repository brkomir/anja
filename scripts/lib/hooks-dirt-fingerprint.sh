#!/usr/bin/env bash
# hooks-dirt-fingerprint.sh — one hash of the LIVE tree's uncommitted state under .claude/hooks/.
#
# Sourced by scripts/smoke-mutation-matrix.sh around its isolated run. That run must leave the live
# hooks exactly as it found them, and the proof used to be "is .claude/hooks/ clean?". On this shared
# tree another session's uncommitted hook edit is routine, so the absolute check read a peer's work as
# this run's fault and turned every clean gate run into ISOLATION-FAIL while any hook was dirty
# (measured 2026-10-05: a peer's block-dangerous.sh + kill-option-order.py mid-edit). The matrix now
# compares this fingerprint BEFORE and AFTER its run instead.
#
# Usage:  hooks_fingerprint <repo-root> <base-sha>
#   Prints one hash over: the binary diff of .claude/hooks/ from <base-sha> to the WORKTREE (tracked
#   edits, staged or not, and deletions), plus the name and content hash of every untracked,
#   non-ignored file there. The base is a FIXED sha, so a peer COMMITTING mid-run (HEAD moves, the
#   worktree does not) leaves it unchanged; a peer EDITING a hook mid-run changes it, and the matrix
#   then reports ISOLATION FAILED, the conservative reading.
#   Returns non-zero, printing nothing, when a git call fails, so a caller never compares two empty
#   strings and reads them as equal.
# The suite's `hooks-fingerprint:` arms (scripts/smoke-test-hooks.sh) drive it on a scratch repo.

hooks_fingerprint() {
  local repo="$1" base="$2" diff untracked f h
  # --no-ext-diff --no-textconv: a diff.external or a textconv driver in any config plane would replace the
  # bytes with its own rendering, and two different hook edits then hash equal (measured: both blind it).
  diff="$(git -C "$repo" diff --no-ext-diff --no-textconv --binary "$base" -- .claude/hooks/)" || return 1
  untracked="$(
    git -C "$repo" ls-files -o --exclude-standard -z -- .claude/hooks/ | while IFS= read -r -d '' f; do
      h="$(git -C "$repo" hash-object -- "$f")" || exit 1
      printf '%s %s\n' "$h" "$f"
    done
  )" || return 1
  printf 'diff:\n%s\nuntracked:\n%s\n' "$diff" "$untracked" | git hash-object --stdin
}
