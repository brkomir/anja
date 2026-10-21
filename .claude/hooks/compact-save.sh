#!/usr/bin/env bash
# PreCompact hook — checkpoint session state before Claude Code compacts context.
#
# v2.8.1 top-priority adoption of vinicius91carvalho's compact-save/restore pair.
# Addresses an audit finding: zero
# state preservation across compaction. This session compacted — THIS hook
# would have captured active-flow context that was silently lost.
#
# MODE: INFORMATIONAL (exit 0), with ONE block path: on a MANUAL compaction it first runs
# precompact-save-guard.py, whose refusal (its exit 75) becomes this hook's exit 2 and holds that /compact once
# while the owner's /pre-compact save has not landed. Checkpoint is a write-only artifact
# that compact-restore.sh reads on PostCompact.
#
# Writes to: .claude/state/compact-checkpoint.md (the SHARED spectator log, appended) AND
#            .claude/state/compact-checkpoint-<sid8>.md (THIS session's file — the one the start-up hook replays).
# Format per checkpoint:
#   ## YYYY-MM-DD HH:MM:SS UTC
#   - branch: main
#   - HEAD: <sha> <subject>
#   - cwd: <repo-path>
#   - staged/dirty: {counts from git status --short}
#   - recent commits (10):
#     {last 10 commits from current branch}
#
# Smoke-tested 2026-04-18: mock PreCompact invocation produced well-formed
# checkpoint block. Fresh sessions after compaction read last block.

set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

# COMPACT_STATE_DIR override exists for the smoke suite (side-effect-free runs).
state_dir="${COMPACT_STATE_DIR:-$ROOT/.claude/state}"
checkpoint_file="$state_dir/compact-checkpoint.md"

# Parse stdin (PreCompact JSON: { session_id, trigger: "manual"|"auto",
# custom_instructions, ... }) for the pending-marker write below. Defensive:
# empty/absent fields degrade to empty strings, hook never blocks.
INPUT="$(cat 2>/dev/null || true)"
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // empty' 2>/dev/null)
  FOCUS=$(printf '%s' "$INPUT" | jq -r '.custom_instructions // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  TRIGGER=$(printf '%s' "$INPUT" | grep -oE '"trigger"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  FOCUS=$(printf '%s' "$INPUT" | grep -oE '"custom_instructions"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# The /pre-compact save guard runs FIRST and in series: a refused /compact must leave
# no checkpoint and no post-compact-pending marker behind, and hooks on one event may run in parallel, so the
# guard cannot be a registration of its own. Manual only, so an automatic compaction can never be held; only the
# guard's own exit 75 becomes the exit 2 that blocks, and any other exit (python3's own 2 included) carries on.
GUARD="$ROOT/.claude/hooks/precompact-save-guard.py"
if [ "${TRIGGER:-}" = "manual" ] && [ -f "$GUARD" ]; then
  printf '%s' "$INPUT" | CLAUDE_PROJECT_DIR="$ROOT" PRECOMPACT_GUARD_CALLER=compact-save.sh python3 "$GUARD"
  [ $? -eq 75 ] && exit 2   # only the guard's own block code; python exits 2 when it cannot open the file
fi

# Create state dir if missing (idempotent)
mkdir -p "$state_dir" 2>/dev/null || { exit 0; }

# Create file with header if first run
if [[ ! -f "$checkpoint_file" ]]; then
  cat > "$checkpoint_file" <<'EOF'
# Compact Checkpoint Log

Per-compaction state checkpoints written by `.claude/hooks/compact-save.sh` (PreCompact).
A SPECTATOR log — every session appends here, no hook replays from it. Each session's own replay file is `.claude/state/compact-checkpoint-<sid8>.md` (same blocks, that session only), which `.claude/hooks/session-start.sh` (SessionStart, source=compact) prints after a compaction.

Newest block last, and the file is SHARED by every session on this tree — the last block is whichever seat compacted most recently. Each block carries `- session: <sid8>`; find a session's with `grep -n '^- session: <sid8>' .claude/state/compact-checkpoint.md` (never `tail`, which shows a peer's).

---
EOF
fi

# Collect state (all defensive — any failure drops to empty, hook never blocks)
timestamp=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
head_info=$(git log -1 --oneline 2>/dev/null || echo "no-commits")
cwd=$(pwd)

staged_count=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
dirty_count=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
untracked_count=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

recent_commits=$(git log --oneline -10 2>/dev/null || echo "no-history")

# Build the checkpoint block ONCE, then write it twice: to the shared log (a SPECTATOR artifact —
# every session appends here, humans and the instinct sweep read it, no hook replays from it) and
# to THIS session's own file, which is what session-start.sh replays after the compaction.
# Why a file per session:
# the shared log had grown to 2.46 MB / 1,464 blocks and the replay was a picker over it that
# needed labels, a fallback and an empty-stamp guard. A file per session needs none of that —
# the same shape post-compact-pending-$SID already uses twenty lines below.
block=$(
  echo ""
  echo "## $timestamp"
  echo "- session: ${SID%%-*}"
  echo "- branch: $branch"
  echo "- HEAD: $head_info"
  echo "- cwd: $cwd"
  echo "- staged/dirty/untracked: $staged_count / $dirty_count / $untracked_count"
  echo "- recent commits (10) — SHARED BRANCH (all sessions; NOT this session's work — attribution needs trailers):"
  echo "\`\`\`"
  echo "$recent_commits"
  echo "\`\`\`"
  echo ""
  echo "---"
)
printf '%s\n' "$block" >> "$checkpoint_file"
# ⛔ Guard the FIRST COMPONENT, not the whole id (measured): the whole-id
# class admits `-`, so a dash-LEADING sid passes it while `${SID%%-*}` collapses to "" and the
# file becomes `compact-checkpoint-.md` — an anonymous file any sid-less reader would open.
own_sid8="${SID%%-*}"
if [[ -n "$own_sid8" ]] && [[ "$own_sid8" =~ ^[a-zA-Z0-9_]+$ ]]; then
  own_file="$state_dir/compact-checkpoint-${own_sid8}.md"
  if [[ ! -f "$own_file" ]]; then
    {
      echo "# Compact checkpoints — session ${SID%%-*}"
      echo ""
      echo "Written by \`.claude/hooks/compact-save.sh\` (PreCompact) for THIS session only; newest block last."
      echo "Replayed by \`.claude/hooks/session-start.sh\` (SessionStart, source=compact). Pruned after 48h idle."
      echo ""
      echo "---"
    } > "$own_file"
  fi
  printf '%s\n' "$block" >> "$own_file"
fi

# Post-compact pending marker (layer 2 — 2026-07-04). The SessionStart:compact
# directive is ONE injection at turn 0; both prior channels failed SILENTLY (PostCompact
# agent-invisible; SessionStart directive truncated behind a 44KB mail dump). This marker
# is the persistent net: post-compact-pending-check.sh (UserPromptSubmit) re-surfaces it
# on EVERY prompt until /post-compact (run or named-skip) clears it — and an
# uncleared marker is MEASURABLE evidence of a missed recovery (the telemetry the
# directive-only design lacked).
# ⛔ `focus=` MEASURES ARGUMENT PRESENCE, NOT CURATION — IT IS NOT A SKIP LICENCE ON ITS OWN.
# This comment read "focus=yes marks an owner-curated /compact <focus> (the skip-eligible
# case)" until 2026-09-09, and the skill specs granted the named skip on that basis.
# A shell hook cannot tell a CURATION OF THE CUTOFF from a DIRECTIVE that happens to be
# typed in the same slot, because that is a judgement about natural language. MEASURED 2 OF 2
# in one session: two arguments that each asked for a follow-up action (run a plan file
# afterwards; prepare for a wrap-up run) both produced focus=yes and neither curated
# anything. The existing trim guard was aimed at the WHITESPACE-ONLY case, which does not
# occur, while the case that occurs 2 of 2 sailed past it.
# THE FIX IS TO MAKE THE ARGUMENT VISIBLE AND MOVE THE JUDGEMENT TO THE READER: `focus_args`
# carries the actual text so post-compact/SKILL.md and wrap Step 0 can judge it instead of
# trusting a boolean. `focus=` keeps its name and shape because consumers read the line
# verbatim (post-compact-pending-check.sh echoes the whole content into its banner).
if [[ -n "${SID:-}" ]] && [[ "$SID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  # Whitespace-only custom_instructions must NOT read as argument-present (a
  # false focus=yes wrongly tells the agent the recovery-skip is eligible — the
  # asymmetric-dangerous direction). Trim before the test.
  ftrim=$(printf '%s' "${FOCUS:-}" | tr -d '[:space:]')
  focus_flag="no"; [[ -n "$ftrim" ]] && focus_flag="yes"
  # One line, bounded, control-bytes stripped: this is OWNER TEXT going into a file every
  # seat reads, so it must not be able to forge a field or break the single-line format.
  # `=` is neutralised too, which makes field-forging structurally impossible rather than
  # merely unlikely: a newline collapsed to a space still concatenates, so without it
  # `a\nfocus=no b` lands in the line as `a focus=no b` and a consumer grepping `focus=` could
  # match the forged one. ⚠️ THIS PARAGRAPH SAID "`=` is stripped" AND CLAIMED THE OUTPUT
  # `afocusno b` UNTIL 2026-09-09 — both were true of the DELETE form and are false now:
  # substituting yields `a focus~no b`, and the sentence "a rare argument loses a character
  # rather than the format losing its integrity" was the exact trade a review refused (see the
  # block below). Trailing/leading space trimmed so a whitespace-only arg reads `<none>`.
  # ⛔ SUBSTITUTE `=`, NEVER DELETE IT. The guarantee is
  # that operator text cannot FORGE a `focus=yes` field, and the consumer that makes it
  # load-bearing is `scripts/wrap-reconcile.mjs`'s focus test — which was UNANCHORED over the
  # whole marker line, so an argument merely CONTAINING that literal flipped a genuine focus=no
  # to SKIP-SANCTIONED. (That regex is now field-anchored too; this stays as the second layer.)
  # Deleting the character kept the guarantee and CORRUPTED THE TEXT: `restrict to env=prod only`
  # became `restrict to envprod only` — on the one field whose entire purpose is that a human
  # reads it and judges it. `=` -> `~` is identical for every predicate and lossless for the
  # reader. ⚠️ THE TWO HALVES ARE COUPLED: translating control chars to SPACE (rather than
  # deleting them) makes the `=` handling MORE necessary, so never ship one without the other.
  focus_args=$(printf '%s' "${FOCUS:-}" | tr '\000-\037' ' ' | tr '=' '~' | tr -s ' ' | sed 's/^ *//; s/ *$//' | cut -c1-160)
  printf 'compacted=%s trigger=%s focus=%s focus_args=%s\n' "$timestamp" "${TRIGGER:-unknown}" "$focus_flag" "${focus_args:-<none>}" \
    > "$state_dir/post-compact-pending-$SID" 2>/dev/null || true
  # ONE-TIME raw-stdin capture (the PreCompact schema is UNDOCUMENTED;
  # custom_instructions presence is unverified on the real harness). The first real
  # compaction after this ships writes the sample; read it to confirm the field
  # arrives (+ its empty-on-auto shape), then DELETE this block + the sample.
  sample="$state_dir/precompact-stdin-sample.json"
  [ -f "$sample" ] || printf '%s' "$INPUT" > "$sample" 2>/dev/null || true
fi

# Shell-trap once-per-context dedupe (shell-trap-inject.sh): the injector shows each
# trap once per context, keyed on session_id plus agent_id for a dispatched seat. A compaction REPLACES the
# context, so the earlier delivery is gone and the trap must be able to come back.
# ⛔ THE PreCompact PAYLOAD CANNOT SAY WHICH CONTEXT COMPACTED. It never carries agent_id (2.1.280 builds it
# with no tool-use context, so agent_id is undefined and dropped), and a sub-agent's compaction arrives with
# the PARENT's session_id — six sub-agent compactions on 2026-09-21..23 each left a checkpoint block under the
# parent's sid at a time the parent did not compact. Deleting one file by exact name therefore cleared the
# MAIN file on every agent compaction and never the agent's, leaving that agent's traps suppressed in its
# rebuilt context. So clear the session's main file AND every agent file: a context that did not compact
# pays one repeat, a context that did is never left suppressed. The id predicate is the injector's.
# Stale files from ended sessions are pruned after 48h on the same pass (`-mmin +2880`, not `-mtime +2`:
# this box's BSD find floors `-mtime`, so `+2` meant 72h, measured).
if [[ -n "${SID:-}" ]] && [[ "$SID" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
  rm -f "$state_dir/shell-traps-seen-${SID}.txt" "$state_dir/shell-traps-seen-${SID}-"*.txt 2>/dev/null || true
  find "$state_dir" -maxdepth 1 -name 'shell-traps-seen-*.txt' -mmin +2880 -delete 2>/dev/null || true
fi

exit 0
