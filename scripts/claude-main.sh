#!/usr/bin/env bash
# claude-main.sh — launch an INTERACTIVE main session with the orchestrator doctrine in the SYSTEM prompt.
#
# WHY this launcher was adopted: Claude Code 2.1.292, measured through
# body-logging proxies by two seats, puts prompt-cache breakpoints only on the system prompt and on the LAST
# message block. Everything in the first user message — CLAUDE.md, rules, MEMORY.md, SessionStart output, the
# git snapshot, the date and the prompt — is one cache unit, so none of it is ever read from cache by another
# session or after a compaction. System-prompt bytes are: with --append-system-prompt-file, a second session
# with a DIFFERENT first prompt read the doctrine from cache, it survived /compact, and a dispatched sub-agent
# did not receive it. Sized at ~12-22M base-input-equivalent a week, mostly at compactions.
#
# HOW: concatenate .claude/orchestrator/{conventions,session-doctrine}.md at ONE resolved HEAD (a file missing there
# launches without the flag, see below) into a content-addressed file under .claude/state/, then exec claude with --append-system-prompt-file and
# SKIP_ORCHESTRATOR_INJECT=1 (orchestrator-inject.sh already honors it, so nothing is delivered twice). The
# launch commit is exported as CLAUDE_RESIDENT_DOCTRINE_COMMIT so session-start.sh can say, after a
# compaction, which doctrine files changed since launch (the appended file is read once per process).
#
# A session launched any other way (plain `claude`, the desktop app) keeps today's SessionStart delivery.
# Non-interactive runs (-p / --print) pass straight through untouched. Escape: run `command claude` directly.
set -uo pipefail
# Resolve a symlinked alias to the real script: dirname of the LINK would make the link's grandparent the
# "repo" and read its .claude/orchestrator/*.md into the system prompt.
_cm_src="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")"
REPO="$(cd "$(dirname "$_cm_src")/.." && pwd)"
CLAUDE_BIN="${CLAUDE_MAIN_BIN:-claude}"   # test seam
# `--` ends option parsing (a following "-p" is a prompt); a short-flag cluster carrying p (-cp) is still --print.
for a in "$@"; do case "$a" in --) break ;; -p|--print|--print=*|-[!-]*p*) exec "$CLAUDE_BIN" "$@" ;; esac; done
# Only for a session in THIS repository (a worktree of it included): run from another project, the doctrine
# would land in that project's system prompt. Not this repo -> plain launch, today's delivery.
_cm_gd="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$_cm_gd" ] && [ "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$_cm_gd" ] \
  || exec "$CLAUDE_BIN" "$@"
STATE="$REPO/.claude/state"; mkdir -p "$STATE" 2>/dev/null
# ONE HEAD for both reads AND the label: re-reading HEAD per file let a peer commit between the reads label old
# bytes with a newer sha, which silences the post-compaction staleness line.
COMMIT="$(git -C "$REPO" rev-parse --verify -q HEAD 2>/dev/null)" || exec "$CLAUDE_BIN" "$@"
TMP="$(mktemp "$STATE/resident-doctrine.XXXXXX")" || exec "$CLAUDE_BIN" "$@"
for f in conventions.md session-doctrine.md; do
  # Committed bytes only: a peer's uncommitted edit must not fork the cache lineage. A file missing at COMMIT
  # launches WITHOUT the flag, so orchestrator-inject.sh delivers the worktree copy AND its DARK banner; a
  # half-built file plus SKIP_ORCHESTRATOR_INJECT=1 would silence that banner.
  git -C "$REPO" show "$COMMIT:.claude/orchestrator/$f" >> "$TMP" 2>/dev/null || { rm -f "$TMP"; exec "$CLAUDE_BIN" "$@"; }
  printf '\n' >> "$TMP"
done
if [ "$(wc -c < "$TMP" | tr -d ' ')" -le 1000 ]; then rm -f "$TMP"; exec "$CLAUDE_BIN" "$@"; fi
# Content-addressed: immutable once written, so every launch with the same doctrine passes the same bytes (one
# cache lineage), and a later doctrine commit can never change the file a running session was launched with.
# An empty hash would name every doctrine "resident-doctrine-.md" and reuse the first one forever.
H="$(shasum -a 256 "$TMP" | cut -c1-12)"
[ "${#H}" -eq 12 ] || { rm -f "$TMP"; exec "$CLAUDE_BIN" "$@"; }
OUT="$STATE/resident-doctrine-$H.md"
# Sweep BEFORE choosing: sweeping after the choice deleted the file this launch was about to pass once the
# doctrine sat unchanged for 15 days ("Append system prompt file not found").
find "$STATE" -maxdepth 1 \( -name 'resident-doctrine-*.md' -o -name 'resident-doctrine.??????' \) -mtime +14 -delete 2>/dev/null || true
# Always rename: an existing file of that name is never TRUSTED (a same-name file with other bytes, or a
# symlink, was reused verbatim), and same name = same bytes, so a running session loses nothing. The rename
# also refreshes the mtime the sweep reads.
mv -f "$TMP" "$OUT"
exec env SKIP_ORCHESTRATOR_INJECT=1 CLAUDE_RESIDENT_DOCTRINE_COMMIT="$COMMIT" \
  "$CLAUDE_BIN" --append-system-prompt-file "$OUT" "$@"
