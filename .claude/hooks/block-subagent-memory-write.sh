#!/usr/bin/env bash
# PreToolUse hook — block Edit/Write on .claude/skills/*/MEMORY.md.
# ENFORCEMENT LAYER — 2026-04-20.
#
# Background:
#   An agent-definition template update told agents not to Edit/Write their
#   own MEMORY.md. That instruction works ~85-90% of the time; ~10-15% the
#   agent ignores it and self-persists, which truncates its structured verdict
#   in orchestrator view (a recurring pattern). A performance-expert dispatch just
#   hit this again despite the template being correct in .claude/agents/.
#
#   Root cause: instruction layer vs enforcement layer. Instructions can be
#   ignored; hooks can't. This is the enforce-layer fix.
#
# What this blocks:
#   Any Edit or Write on a path matching .claude/skills/*/MEMORY*.md (the whole
#   memory tier family — MEMORY.md AND MEMORY-ARCHIVE*.md), plus the meta live
#   registers WATCH-TIER.md / ADOPTION-QUEUE.md. Subagents and orchestrator
#   alike — the ONE canonical path for MEMORY persistence is Bash append (>>)
#   per /expert-review Step 8a spec. Subagents emit the Memory Update block in
#   their structured response text; orchestrator extracts and appends
#   post-synthesis.
#
# ⛔ WIDENED 2026-08-06 (PHASE 1 of the meta memory archive split) — this was a
#   LIVE HOLE, not a prospective one. The patterns ended `MEMORY\.md$`, so
#   the 24 MEMORY-ARCHIVE.md files that have existed since 2026-08-01 were
#   directly Edit/Write-able by any sub-agent. Those archives hold the FULL
#   VERBATIM BODIES of every cold entry — the hot MEMORY.md keeps only digests
#   pointing INTO them — so the guard was protecting the index and leaving the
#   corpus open. Scope was never the intent; the pattern simply predated the
#   split convention by about fifteen weeks.
#
#   WATCH-TIER.md / ADOPTION-QUEUE.md are included DELIBERATELY. They are not
#   new surfaces: they are two H2 sections being carved OUT of meta/MEMORY.md
#   (162 KB + 70 KB), where they are protected today. Leaving them out would
#   mean a pure file-move SILENTLY REVOKED their protection — a regression
#   caused by refactoring, which is the class this enforce layer exists for.
#   Nothing legitimate is lost: both orchestrator carve-outs below (Bash `>>`
#   append and the /tmp/claude-meta-mem-allow marker) apply to them unchanged.
#
# Bypass (for legitimate orchestrator bulk ops — /meta distill, memory-audit):
#   Touch /tmp/claude-meta-mem-allow before the batch edit; remove after.
#   The hook lets the main session through when this marker file exists; a
#   sub-agent is refused even then (see the escape note below). A payload the
#   hook cannot parse is refused for both, marker or not.
#
# Log:
#   Every block is appended to .claude/logs/subagent-memory-block.log with
#   timestamp + tool + path. Enables verification that the hook is firing and
#   calibration of false-positive / false-negative rates.
#
# Companion to:
#   - .claude/hooks/log-memory-writes.sh (diagnostic logger, never blocks)
#   - /expert-review Step 8a (orchestrator-side MEMORY persistence spec)

set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

INPUT=$(cat 2>/dev/null || echo "{}")

# FIRES LOG (2026-09-13). This gate DENIES on TWO paths and neither could be calibrated: the fail-closed
# backstop below wrote nothing at all, and the precise path wrote only a PLAIN-TEXT line
# (`<ts> BLOCKED <tool> <path>`) with no arm, no session and no agent — so no per-arm false-positive rate
# could be computed from it, which is the whole point of a fires corpus
# (session-cadence.md § READING A GUARD'S FIRES). Both paths now also append a JSONL record through the
# shared library, to .claude/logs/subagent-memory-block-fires.jsonl. The plain-text log STAYS: it is the
# human-tailable record this hook's own header advertises, and the two answer different questions.
# ⛔ THE LIBRARY IS SOURCED IN A SUBSHELL, AND EVERY VALUE AT A CALL SITE IS BRACED. Sourced in this
# hook's own shell, a library that still PARSES can end the hook before it emits — a trailing `exit 0`
# gives rc 0, an unset read under `set -u` gives rc 1, both silent on either channel, and a PreToolUse
# hook that emits no deny document has ALLOWED the write. `bash -n` passes both shapes. Inside `( … )`
# they end only the child. A value expanded at a CALL SITE is evaluated before the subshell exists, so
# write every value as `${v:-}`. Mechanism + measurements: lib/fires-log.sh § WHERE TO SOURCE.
# sid / agent_id come from THIS call's PAYLOAD, never an environment variable: with the env-var form an
# unset variable does not mislabel the record, it loses the deny. The extractor is the grep form so it is
# independent of whether jq is present — one of the two callers is the branch reached when it is not.
_bsm_payload_field() {
  printf '%s' "${INPUT:-}" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}
# REFUSE-ONLY sub-agent test: the KEY's presence, any value (block-subagent-always-loaded-write.sh _al_is_subagent).
_bsm_is_subagent() { printf '%s' "${INPUT:-}" | grep -qE '"agent_id"[[:space:]]*:'; }
_bsm_fire() {
  ( fires_log() { :; }   # fallback: an unloadable lib degrades to NO RECORD, never to a broken deny
    . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log subagent-memory-block sid "$(_bsm_payload_field session_id)" agent_id "$(_bsm_payload_field agent_id)" "$@"
  ) >/dev/null 2>&1 || true
}

# jq-FIRST, grep-FALLBACK — a security gate must NOT depend on jq being installed. The prior version
# extracted via jq with 2>/dev/null and NO fallback: jq absent ⇒ FILE_PATH="" ⇒ the `[ -z ]` guard
# below exits 0 ⇒ the gate fails OPEN, machine-wide, SILENTLY (a sub-agent memory write proceeds
# because the gate couldn't parse the path). block-dangerous.sh's JQ_USED extraction already mirrors this pattern.
if command -v jq >/dev/null 2>&1; then
  TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
else
  TOOL=$(printf '%s' "$INPUT" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
  FILE_PATH=$(printf '%s' "$INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
fi

# FAIL-CLOSED BACKSTOP: if neither extractor yielded a path BUT the raw payload literally mentions a
# protected MEMORY.md, we cannot PROVE the write is safe → DENY rather than allow. This is what makes
# the gate fail-closed even against a jq-absent AND grep-defeating payload (an escaped quote in a
# path, a mangled encoding). It only fires when the protected pattern is actually present, so a normal
# non-MEMORY write with an unparseable payload still passes (exit 0 below).
if [ -z "$FILE_PATH" ]; then
  # Same family as the CANON/RAW match below — a fail-closed backstop that knows a NARROWER set
  # of protected paths than the primary gate is a hole in the exact case the backstop exists for
  # (an unparseable payload targeting an archive would have sailed through while the identical
  # parseable payload was denied). `[^"/]*` after MEMORY stays inside one filename token.
  if printf '%s' "$INPUT" | grep -qiE '\.claude/skills/[^"]*(MEMORY[^"/]*|WATCH-TIER[^"/]*|ADOPTION-QUEUE[^"/]*|CHANGELOG-ARCHIVE[^"/]*)\.md'; then
    _bsm_fire arm fail-closed-unparseable tool "${TOOL:-}" payload "${INPUT:-}"
    if _bsm_is_subagent; then
      printf '%s\n' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Memory-tier enforcement (fail-closed): could not parse the tool payload, and it references a protected memory-tier path. A sub-agent does not write the memory tier. Put your findings in the ### Memory Update section of your structured response; the orchestrator persists them."}}'
      exit 0
    fi
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Memory-tier enforcement (fail-closed): could not parse the tool payload to confirm this is a safe write, and the payload references a protected path — .claude/skills/*/MEMORY*.md (incl. MEMORY-ARCHIVE-*.md shards), the meta CHANGELOG-ARCHIVE-*.md shards, or a meta live register (WATCH-TIER.md / ADOPTION-QUEUE.md, incl. -ARCHIVE siblings) — the full set this branch's own matcher covers. Denying conservatively. If you are the orchestrator, use Bash append to the CURRENT DATED SHARD ('echo \"$block\" >> .claude/skills/<expert>/MEMORY-ARCHIVE-<from>-<to>.md', the MAX END-DATE shard, never ls -t) — NOT the router MEMORY.md, which is regenerated and would drop the append. The escape marker is not honoured on this unparseable-payload path."
  }
}
EOF
    exit 0
  fi
  exit 0
fi
# Canonicalize (resolve ../ lexically, NO filesystem access) so a traversal like
# `.claude/skills/x/../meta/MEMORY.md` cannot slip past the single-segment match; case-INsensitive
# because the macOS default FS is case-insensitive (`memory.md` resolves to the same file `MEMORY.md`
# would). Both bypasses were measured live 2026-07-13. python3 normpath is the portable canonicalizer;
# on its absence fall back to the original path (the -i grep still catches the non-traversal case).
CANON="$(python3 -c 'import os,sys; print(os.path.normpath(sys.argv[1]))' "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")"
# Match the CANONICAL path precisely (single segment), OR — so the guarantee does NOT depend on python3
# — the RAW path with a MULTI-segment pattern that admits an unresolved `../` traversal.
# The `.+/` fallback is over-block-safe: a skills MEMORY.md is always one level deep, so a deep/traversal
# path is never legitimate. Covers the python3-absent case without a fragile sed collapse.
if ! { printf '%s' "$CANON" | grep -qiE '\.claude/skills/[^/]+/(MEMORY[^/]*|WATCH-TIER[^/]*|ADOPTION-QUEUE[^/]*|CHANGELOG-ARCHIVE[^/]*)\.md$' \
       || printf '%s' "$FILE_PATH" | grep -qiE '\.claude/skills/.+/(MEMORY[^/]*|WATCH-TIER[^/]*|ADOPTION-QUEUE[^/]*|CHANGELOG-ARCHIVE[^/]*)\.md$'; } 2>/dev/null; then
  exit 0
fi

# Bypass for legitimate orchestrator bulk ops. Default marker is /tmp/claude-meta-mem-allow (the
# documented orchestrator path); FF_MEM_ALLOW_MARKER overrides it so the smoke suite can test the bypass
# against a PER-PROCESS temp marker without touching the live default the fleet reads.
# A SUB-AGENT NEVER HOLDS THE ESCAPE (after cosmix/loom's hook exemptions,
# which key on a payload field a caller cannot set; loom's field grants, ours only refuses) — see
# block-subagent-always-loaded-write.sh marker_live for why the payload's agent_id may refuse and never grant.
if [ -f "${FF_MEM_ALLOW_MARKER:-/tmp/claude-meta-mem-allow}" ] && _bsm_is_subagent; then
  _bsm_fire arm subagent-marker-refused tool "${TOOL:-}" file "${FILE_PATH:-}"
elif [ -f "${FF_MEM_ALLOW_MARKER:-/tmp/claude-meta-mem-allow}" ]; then
  exit 0
fi

# Log the block for observability + calibration
LOG_DIR="${HOOK_FIRES_LOG_DIR:-$ROOT/.claude/logs}"  # the smoke suite exports it; this .log held 3,034 lines 2026-09-13..10-09 against 172 live denies in the JSONL
mkdir -p "$LOG_DIR" 2>/dev/null || true
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '%s BLOCKED %s %s\n' "$TS" "$TOOL" "$FILE_PATH" >> "$LOG_DIR/subagent-memory-block.log" 2>/dev/null || true
_bsm_fire arm protected-path tool "${TOOL:-}" file "${FILE_PATH:-}" canon "${CANON:-}"

# A sub-agent is told only its own route — never the orchestrator's two doors (the marker, refused to it
# above, and the Bash append the orchestrator text prescribes). Deny text that hands the denied party a
# bypass is an anti-pattern autonomous-dev names.
if _bsm_is_subagent; then
  printf '%s\n' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Memory-tier enforcement: a sub-agent does not write the memory tier (.claude/skills/*/MEMORY*.md and their archive shards, the meta CHANGELOG archives, WATCH-TIER.md, ADOPTION-QUEUE.md). Put your findings in the ### Memory Update section of your structured response; the orchestrator persists them."}}'
  exit 0
fi
# Emit denial decision per PreToolUse hook schema
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Memory-tier enforcement: do not Edit/Write the meta memory tier directly — .claude/skills/*/MEMORY*.md (incl. MEMORY-ARCHIVE-*.md shards), the meta CHANGELOG-ARCHIVE-*.md shards, AND the meta live registers WATCH-TIER.md / ADOPTION-QUEUE.md (incl. -ARCHIVE siblings), all covered deliberately (see this hook's header). If you are a subagent (expert), emit your findings in the '### Memory Update' section of the Required Output Format — the orchestrator extracts and appends post-synthesis. If you are the orchestrator persisting Memory Update blocks per /expert-review Step 8a, use Bash append to the CURRENT DATED SHARD ('echo \"\$block\" >> .claude/skills/<expert>/MEMORY-ARCHIVE-<from>-<to>.md', the MAX END-DATE shard, never ls -t) — NOT the router MEMORY.md, which is regenerated and would drop the append — that path is explicitly supported and bypasses this hook. For bulk rewrites (/meta distill, /meta memory-audit), touch /tmp/claude-meta-mem-allow before the batch, then remove after."
  }
}
EOF

exit 0
