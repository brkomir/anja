#!/usr/bin/env bash
# PreToolUse hook — block Edit/Write/MultiEdit on ALWAYS-LOADED files.
# Rule: writes to always-loaded files are guarded the same way memory writes are — a
# sub-agent does not write them directly; the orchestrator does.
#
# PROTECTED SET (the always-loaded corpus — every seat loads these on every turn):
#   .claude/rules/*.md
#   CLAUDE.md
#   AGENTS.md
#   .claude/orchestrator/*.md   (the Band-O injection source)
#
# WHY THIS IS THE HIGHEST-BLAST-RADIUS WRITE IN THE REPO:
#   These files are re-read by EVERY seat on its NEXT TURN. There is no build step and no
#   cache: the bytes on disk ARE the live artifact from the moment they are written. A
#   sub-agent that edits one has changed what every other session believes, immediately,
#   fleet-wide — and unlike a tracker row or a test, a wrong sentence here fails MUTE. It
#   misleads silently and indefinitely, because its readers are not looking for state, they
#   are absorbing an invariant (`tests-unit.md` § sweep the DURABLE layer first).
#
#   The sub-agent case is worse than the orchestrator case for a structural reason: a
#   sub-agent's context is a SLICE. It holds its brief and the always-loaded band, not the
#   session's history, not the peer traffic, not the owner's rulings this turn — so it is
#   the party least able to judge whether a rule edit contradicts something decided an hour
#   ago. The orchestrator holds that context. This hook makes the routing structural instead
#   of instructional.
#
# ⛔ WHY THIS BLOCKS EVERYONE AND NOT JUST SUB-AGENTS — DO NOT "FIX" THIS.
#   CLAUDE_CODE_CHILD_SESSION is "1" for the ORCHESTRATOR TOO, not only for sub-agents
#   (measured 2026-08-16; `.claude/rules/bash-environment.md` states the same
#   for the sibling case). So NO hook can distinguish orchestrator from sub-agent by that
#   variable. The PAYLOAD does carry one: only a sub-agent's call has a top-level "agent_id"
#   (three sibling hooks branch on it; 5 of 222 write-guard denies 2026-09-13..10-09 carried it).
#   It is used in ONE direction only — marker_live REFUSES the escape to a payload that carries it.
#   Never key an ALLOW on it or on any env var: a discriminator that GRANTS fails OPEN and silent
#   the day the harness stops writing it; one that only REFUSES degrades to the behaviour below.
#   So the design stays: DENY for everyone, plus a marker-file escape the orchestrator takes deliberately.
#
# WIRED ON Edit|Write|MultiEdit FROM BIRTH — this is deliberate: wire a write guard on
#   every write tool. A guard whose PreToolUse matcher names only `Edit|Write` lets
#   MultiEdit past it entirely, whatever its predicate says, so check the matcher as well
#   as the predicate. A guard that covers two of the three write tools
#   is a guard with a hole. MultiEdit's payload carries `tool_input.file_path`
#   like Edit, and MAY carry per-edit `file_path` values in its `edits[]` array — both are
#   extracted below, so neither shape can slip past.
#
# Bypass (for legitimate ORCHESTRATOR rule edits — folding a lesson, a codification, a sweep). The OWNER opens the
# door; a session never creates it, with touch, Write, Edit or any other command (since 2026-10-25):
#   ! touch /tmp/claude-always-loaded-allow.<full session id>     # the owner, before the batch; the deny prints the line
#   rm -f /tmp/claude-always-loaded-allow.$CLAUDE_CODE_SESSION_ID  # the session, after the COMMIT, not the edit (2026-10-28):
#   scripts/safe-commit.sh, scripts/private-index-commit.sh and .githooks/prepare-commit-msg (git's own commit path)
#   refuse a commit carrying one of these files while the door is closed (scripts/always-loaded-commit-gate.sh asks
#   THIS hook, so the set and the 15-min window are one definition), because this hook never sees a shell write
#   such as `git apply`.
#   A session that creates the marker itself routes around a safety control, whatever the auto-mode classifier allows.
#   The marker is PER SESSION since 2026-10-25: it opens the guard for the session whose payload session_id it names, and only until its mtime is 15 min old (FF_ALWAYS_LOADED_ALLOW_TTL_SEC, default 900; 0 = no expiry). The bare /tmp/claude-always-loaded-allow opens nothing.
#   The marker is a DELIBERATE ACT, which is the whole point: it converts an always-loaded
#   write from something that can happen by reflex into something someone chose.
#
# Log:
#   Every block appends to .claude/logs/subagent-always-loaded-block.log (timestamp, tool,
#   path) so the fire rate is measurable rather than assumed — the per-incident TP/FP split
#   this repo's promotion gate (`session-cadence.md`) requires.
#   ⚠️ EVERY `BLOCKED Bash` LINE IN THAT LEDGER IS SYNTHETIC (replay/probe), NOT A LIVE FIRE.
#   The Bash matcher has never been wired in any settings.json revision (verified 2026-08-19:
#   `git log -G 'block-subagent-always-loaded' -- .claude/settings.json` → one revision, its
#   Bash groups carry no such hook), so no Bash payload has ever reached this hook live. The
#   2026-08-19 corpus replay wrote ~3,064 such lines in the live-fire format with no mode
#   field. Exclude tool==Bash from ANY fire-rate derivation until a wiring commit exists;
#   after wiring, only lines NEWER than that commit count.
#
# Companion to (NOT a duplicate of):
#   - .claude/hooks/always-loaded-claim-warn.sh — same FILE SET, different question.
#     That hook is WARN-mode and grades CLAIM QUALITY (stale citations, perishable
#     live-state claims) — it asks "is this sentence going to rot?".
#     THIS hook is BLOCK-mode and grades AUTHORITY — it asks "who is writing?".
#     Both can fire on one payload and neither subsumes the other: a sub-agent writing an
#     impeccably-worded rule is still the wrong author, and the orchestrator writing a stale
#     claim is still writing a stale claim. Ordering is irrelevant (warn prints, block denies).
#   - .claude/hooks/block-subagent-memory-write.sh — the reference implementation,
#     same shape over the MEMORY tier.

set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

INPUT=$(cat 2>/dev/null || echo "{}")

# jq-FIRST, grep-FALLBACK — a security gate must NOT depend on jq being installed. jq absent with
# no fallback ⇒ empty path ⇒ the gate exits 0 ⇒ fails OPEN, machine-wide, SILENTLY. Mirrors
# the jq-first extraction in block-subagent-memory-write.sh and block-dangerous.sh's JQ_USED extraction.
#
# BOTH extractors collect EVERY candidate path, never `head -1`. MultiEdit is why: its payload can
# carry a top-level file_path AND per-edit ones, and a first-match extractor would grade the write
# on whichever happened to serialize first.
TOOL=""; PATHS=""
if command -v jq >/dev/null 2>&1; then
  TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
  PATHS=$(printf '%s' "$INPUT" | jq -r '[(.tool_input.file_path? // empty), (.tool_input.edits[]?.file_path? // empty)] | .[]' 2>/dev/null)
fi
# ⛔ FALL THROUGH ON AN EMPTY jq RESULT — DO NOT MAKE THIS AN `else`.
# `command -v jq` answers "is there a file named jq on PATH", NOT "does it work". A jq that is
# present but BROKEN (a shim, a bad build, a version whose filter syntax changed) exits non-zero
# with empty stdout, which an if/else reads as "no path in this payload" and routes straight to
# the fail-closed backstop. That backstop scans the WHOLE payload, so an edit to a NON-protected
# file whose CONTENT merely mentions a rules path would be DENIED — measured live while building
# this hook, on the exact payload shape `scripts/smoke-test-hooks.sh` is full of.
# Trying the second extractor first makes the backstop a LAST resort instead of a second step:
# fail-closed is preserved (both extractors must come up empty), and the false-positive class
# disappears. The reference guard has the if/else shape and inherits the same over-block.
if [ -z "$PATHS" ]; then
  PATHS=$(printf '%s' "$INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"//; s/"$//')
fi
if [ -z "$TOOL" ]; then
  TOOL=$(printf '%s' "$INPUT" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
fi

# The protected set, as ONE definition used by both the precise gate and the fail-closed backstop.
# ⚠️ A backstop that knows a NARROWER set than the primary gate is a hole in the exact case the
# backstop exists for, which is why the precise gate and the backstop read this one
# definition rather than two copies of it.
# Kept deliberately in sync with always-loaded-claim-warn.sh's ALWAYS_LOADED regex: two guards
# over one file set that disagree about its membership ARE a drift surface.
#
# CANON pattern: single-segment, for the traversal-resolved path.
AL_CANON='(^|/)(\.claude/rules/[^/]+\.md|CLAUDE\.md|AGENTS\.md|\.claude/orchestrator/[^/]+\.md)$'
# RAW pattern: multi-segment, admits an UNRESOLVED `../` traversal so the guarantee does not depend
# on python3 being present. Over-block-safe: a rules/orchestrator file is always exactly one level
# deep, so a deeper path there is never legitimate.
AL_RAW='(^|/)(\.claude/rules/.+\.md|CLAUDE\.md|AGENTS\.md|\.claude/orchestrator/.+\.md)$'
# BACKSTOP pattern: unanchored, for scanning a payload we could not parse into a path at all.
# ⚠️ The `(^|[^class])` leg is the idiom `bash-environment.md` documents as a ugrep FALSE ZERO.
# MEASURED, not assumed, 2026-08-16: a hook invoked as `bash <hook>` gets /usr/bin/grep (BSD grep
# 2.6.0-FreeBSD) — the ugrep on this box is an interactive ZSH function that does NOT propagate
# into a bash subprocess — and BSD grep evaluates this pattern correctly on all five probes,
# including the `MYCLAUDE.md` decoy it must NOT match (1/1/1/1/0). Left as-is because it is the
# form that correctly rejects the decoy; if `grep` ever resolves to ugrep inside hooks, re-measure
# rather than trusting this line.
AL_BACKSTOP='\.claude/rules/[^"]*\.md|\.claude/orchestrator/[^"]*\.md|(^|[^A-Za-z0-9_.-])(CLAUDE|AGENTS)\.md'

# ONE CONTAINMENT WALK FOR BOTH ARMS. is_protected (Edit/Write/MultiEdit) and the Bash arm both
# prepend this to their python3 -c program, so "inside this repo" has a single spelling. The Bash
# arm once kept its own lexical copy after the Edit/Write arm moved to the inode walk, and that copy
# failed OPEN under a symlinked project dir. rel_in_root(path, key) returns the path relative to
# ROOT, None when the ancestor chain provably reaches the filesystem root without meeting ROOT
# (another repo), and raises LookupError when containment cannot be decided; every caller treats
# LookupError as fail-CLOSED. No apostrophes below: both callers splice it into a quoted -c string.
CONTAIN_PY='
import os
def root_key(root):
    try:
        rs = os.stat(root)
    except OSError:
        return None
    return (rs.st_dev, rs.st_ino)
def rel_in_root(cand, key):
    if key is None:
        raise LookupError("root")
    cand = os.path.abspath(cand)
    cur = cand
    while not os.path.exists(cur):
        up = os.path.dirname(cur)
        if up == cur:
            raise LookupError("no ancestor")
        cur = up
    for _ in range(400):
        try:
            st = os.stat(cur)
        except OSError:
            raise LookupError("stat")
        if (st.st_dev, st.st_ino) == key:
            return os.path.relpath(cand, cur)
        up = os.path.dirname(cur)
        if up == cur:
            return None
        cur = up
    raise LookupError("depth")
'

is_protected() {
  # $1 = a candidate path. Case-INsensitive: the macOS default FS is case-insensitive, so
  # `claude.md` resolves to the same file `CLAUDE.md` would, and a case-sensitive match would
  # let that alias past. python3 normpath is the portable lexical canonicalizer (NO filesystem
  # access); on its absence the RAW pattern still catches the traversal case.
  local raw="$1" canon
  canon="$(python3 -c 'import os,sys; print(os.path.normpath(sys.argv[1]))' "$raw" 2>/dev/null || printf '%s' "$raw")"
  # ⛔ THE PATTERNS ARE SUFFIX-MATCHES, SO THEY PROTECT ANY REPO ON THIS MACHINE — measured
  # 2026-08-19 on the LIVE Edit/Write path, not the inert Bash branch: a Write to
  # <repos-dir>/SOME-OTHER-PROJECT/CLAUDE.md denied, as did one to a throwaway probe repo
  # under /tmp. The guard's whole rationale is "read by EVERY seat on its next turn", which is
  # false for a file outside this worktree — so those denials protect nothing and cost real work.
  # It bites hardest on the workflow this guard WANTS: the fleet drafts a rules change in a
  # scratch repo, verifies it there, then lands it. Denying the rehearsal pushes seats to take
  # the marker for the whole batch, which disables the guard for the real edit too.
  # Positive containment only: EXCLUDE when we can PROVE the path is outside ROOT. An
  # unresolvable path keeps the old behaviour, so fail-closed is preserved.
  # ⛔ INODE WALK, NOT A LEXICAL TEST: the original os.path.relpath(...).startswith("..") was
  # a STRING comparison, so a case alias (<home-dir> upper-cased) or the macOS
  # /System/Volumes/Data firmlink — the SAME INODE spelled differently — read as
  # outside the repo and walked a write to an always-loaded file straight past the
  # deny. Same class as validating by string match instead of by parsing, one
  # layer down. This walks the ancestor chain comparing (st_dev, st_ino) against
  # ROOT: exit 0 ONLY when the chain provably reaches the filesystem root without
  # ever meeting ROOT (genuinely another repo — the carve this test exists for);
  # any stat failure or a hit on ROOT exits 1, so the suffix-match deny below still
  # applies. Smoke arms pin BOTH directions (case alias + firmlink deny; other-repo
  # spellings stay silent). No apostrophes in this payload — the single-quote rule.
  if [ -n "${ROOT:-}" ]; then
    if python3 -c "$CONTAIN_PY"'
import sys
try:
    r = rel_in_root(sys.argv[1], root_key(sys.argv[2]))
except Exception:
    sys.exit(1)
sys.exit(0 if r is None else 1)' "$canon" "$ROOT" 2>/dev/null; then
      return 1
    fi
  fi
  printf '%s' "$canon" | grep -qiE "$AL_CANON" && return 0
  printf '%s' "$raw"   | grep -qiE "$AL_RAW"   && return 0
  return 1
}

# ── THE ESCAPE MARKER EXPIRES (decided after a 7-lens review) ────────────────
# The bypass was a bare `[ -f ]` on a MACHINE-GLOBAL path with no expiry, no owner and no
# session scope. Measured: 211 commits touched always-loaded files in 10 days, so the marker is
# raised ~21 times a day — and while it is up this guard is OFF for every seat AND every
# sub-agent it dispatches, which is the party the guard exists for. That made the guard's real
# coverage "100% minus however long somebody left it up", and nobody was measuring the second
# term. One seat armed and removed it three times in a single session.
# A TTL turns "forgot to rm" from an indefinite fleet-wide hole into a bounded one. It did NOT
# fix ownership; the per-session marker below (2026-10-25) does: each seat now has its own door.
# Default 15 min: an edit batch is minutes, and a too-short TTL denies an author mid-batch,
# which is how a guard teaches people to work around it.
# ⛔ FAIL-CLOSED ON AN UNREADABLE mtime: if stat cannot answer, the marker does NOT count as
# live and the guard stays ON. `stat -f %m` is BSD/macOS, `stat -c %Y` is GNU/CI — measured here:
# the BSD form works, the GNU form is UNSUPPORTED, so both are tried.
marker_live() {
  local m
  if [ -n "${FF_ALWAYS_LOADED_ALLOW_MARKER:-}" ]; then
    m="$FF_ALWAYS_LOADED_ALLOW_MARKER"       # exact path: the smoke suite's per-process seam
  else
    m=$(_al_session_marker) || return 1      # no usable session_id in the payload = no door
  fi
  [ -f "$m" ] || return 1
  # A SUB-AGENT NEVER HOLDS THE ESCAPE (after cosmix/loom's hook exemptions). Only a
  # sub-agent's payload carries a top-level "agent_id" (commit-doctrine-inject.sh, keep-warm-tool-deny.sh,
  # shell-trap-inject.sh key on it), and a quote inside written content is JSON-escaped, so content
  # cannot forge it. REFUSE-ONLY: if the harness stops writing the field this reverts to today's
  # behaviour, never to an open gate. Own arm slug, so a demotion can argue from fires.
  if _al_is_subagent; then _al_fire arm subagent-marker-refused tool "${TOOL:-}" paths "${PATHS:-}"; return 1; fi
  # 900 is a BOUND, not a measured VALUE — say which, so nobody cites it as calibrated.
  # A TTL's job is to bound the window, and ANY finite bound beats an escape with no
  # expiry, so this is defensible as a bound and unjustified as a
  # number. Do not go hunting a "correct" value; if it proves too short in practice, raise it
  # or export FF_ALWAYS_LOADED_ALLOW_TTL_SEC for the batch.
  local ttl="${FF_ALWAYS_LOADED_ALLOW_TTL_SEC:-900}"
  # ⚠️ NOT A FINDING — do not "fix" the ordering. This short-circuit sits ABOVE
  # the future-mtime clamp below, so TTL=0 + a future-dated marker returns LIVE. That looks like a
  # hole in the clamp and is not one: TTL=0 is the documented escape meaning "no expiry for this
  # batch", so there is no expiry left for a future mtime to defeat — the operator has already said
  # the guard is off. Reordering buys nothing and costs the escape its unconditional meaning.
  # Named here because an un-answered near-miss gets re-investigated at full cost by the next reader
  # (the original probe did not test this state).
  [ "$ttl" = "0" ] && return 0          # 0 disables expiry (escape hatch for a long sanctioned batch)
  local mt now
  # ⛔ GNU FIRST, BSD SECOND — THE ORDER IS LOAD-BEARING AND THE OLD ONE FAILED OPEN.
  # This read "stat -f %m || stat -c %Y" until 2026-08-21. On GNU coreutils -f means
  # --file-system, so "%m" is taken as a FILE operand: the command prints a filesystem
  # block whose first line begins "File: ..." AND exits non-zero. The || never rescues
  # it because stdout is already non-empty, $mt becomes multi-line garbage, and the
  # arithmetic below dies on the bareword "File" under set -u — killing the hook BEFORE
  # it emits any JSON verdict. A hook that dies emits no deny, so on every Linux host
  # this block-mode guard silently STOPPED GUARDING. It surfaced only as 4 red arms in
  # CI; the fleet runs macOS, where the first branch succeeds and the
  # bug is invisible. GNU's -c exits 1 with EMPTY stdout on BSD, so this order is the
  # controlled one in both directions.
  mt=$(stat -c %Y "$m" 2>/dev/null || stat -f %m "$m" 2>/dev/null || echo "")
  # ⛔ NUMERIC, not merely NON-EMPTY. -n alone is what let the garbage through: it is
  # the arithmetic that must be protected, and only a digit test protects it. Fails
  # CLOSED (return 1 = marker not honoured = guard ACTIVE), because the whole defect
  # above was a guard failing OPEN on unexpected input.
  case "$mt" in
    ''|*[!0-9]*)
      echo "always-loaded write guard: could not read a numeric mtime for the bypass marker $m (got: '${mt}') — REFUSING to honour it, the guard is ACTIVE. This is a stat(1) portability failure, not an expiry: neither 'stat -c %Y' nor 'stat -f %m' returned digits. Do not re-touch the marker; fix the stat call." >&2
      return 1
      ;;
  esac
  now=$(date +%s 2>/dev/null || echo "")
  [ -n "$now" ] || return 1
  local age=$(( now - mt ))
  # ⛔ A FUTURE mtime makes age NEGATIVE, and negative is less than any positive TTL — so
  # without this clamp the marker reads LIVE until wall-clock catches up, reproducing the
  # exact un-expiring bypass the TTL was added to prevent. Measured 2026-08-19 (reproduced
  # here): a 2030-dated marker read LIVE at age -106,317,205s,
  # about 3.4 years of a silently disabled block-mode guard. Reachable by clock skew, a
  # drifting VM/container, a restored backup, or a `touch -t` meant to extend a batch.
  # The TTL bounds the window in ONE direction only; this bounds the other.
  # SEPARATE message on purpose: the remedy differs. EXPIRED means the owner re-touches it; FUTURE means
  # the clock or the mtime is wrong, and re-touching blindly is how you keep it disabled.
  if [ "$age" -lt 0 ]; then
    echo "always-loaded write guard: the bypass marker $m is dated in the FUTURE (age ${age}s) — REFUSING to honour it, the guard is ACTIVE. This is clock skew or a 'touch -t', not an expiry. DISCRIMINATE FIRST: compare 'date +%s' against the marker mtime. If the CLOCK is behind, fixing the marker changes nothing and it will re-trigger; fix the clock. If the MARKER is the outlier, rm it and ask the owner to run the touch again. Do NOT just re-touch it: that sets mtime to now and honours a marker you have not diagnosed, and only the owner opens the door." >&2
    return 1
  fi
  [ "$age" -lt "$ttl" ] || {
    echo "always-loaded write guard: the bypass marker $m is older than ${ttl}s and has EXPIRED — the guard is ACTIVE again. If this batch is still running, ask the owner to run the touch again." >&2
    return 1
  }
  return 0
}

# FIRES LOG (2026-09-13). This gate DENIES on FOUR paths and none could be calibrated: two wrote only a
# PLAIN-TEXT line (`<ts> BLOCKED <tool> <path>`) carrying no arm, no session and no agent, and the other
# two — the fail-closed backstop and the Bash unproven-verb arm — wrote nothing at all. No per-arm
# false-positive rate was derivable, which is what a promote/demote argument runs on
# (session-cadence.md § READING A GUARD'S FIRES). Every deny now appends a JSONL record through the
# shared library, to .claude/logs/subagent-always-loaded-block-fires.jsonl. The plain-text log STAYS.
# ⛔ THE LIBRARY IS SOURCED IN A SUBSHELL, AND EVERY VALUE AT A CALL SITE IS BRACED. Sourced in this
# hook's own shell, a library that still PARSES can end the hook before it emits — a trailing `exit 0`
# gives rc 0, an unset read under `set -u` gives rc 1, both silent on either channel, and a PreToolUse
# hook that emits no deny document has ALLOWED the write. `bash -n` passes both shapes. Inside `( … )`
# they end only the child. A value expanded at a CALL SITE is evaluated before the subshell exists, so
# write every value as `${v:-}` — which here is load-bearing beyond the library: HIT and BASH_HIT are
# genuinely UNSET on the paths that do not reach their branch, so a bare `$HIT` would end this hook with
# rc 1 under `set -u` and turn its deny into an allow. Mechanism: lib/fires-log.sh § WHERE TO SOURCE.
# sid / agent_id come from THIS call's PAYLOAD, never an environment variable: with the env-var form an
# unset variable does not mislabel the record, it loses the deny. The extractor is the grep form so it
# does not depend on jq, which one of the four callers is reached precisely because of.
_al_payload_field() {
  printf '%s' "${INPUT:-}" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}
# ── THE MARKER IS PER SESSION (2026-10-25)
# One file, /tmp/claude-always-loaded-allow, used to open this guard for EVERY main session on the machine
# for its 15 minutes. The door is now /tmp/claude-always-loaded-allow.<session_id>, keyed on THIS call's
# payload session_id (the full UUID the harness writes; the fires log records it), so one seat's opening
# covers that seat alone, and the bare shared file opens nothing. The id is held to lowercase hex and '-' (the
# harness's UUID shape) before it becomes part of a path, so a payload cannot aim the test at another file, and an
# upper-case alias cannot reach a lowercase door on case-insensitive /tmp; content cannot forge the key
# (JSON escapes every in-string quote). FF_ALWAYS_LOADED_ALLOW_PREFIX moves the base for tests;
# FF_ALWAYS_LOADED_ALLOW_MARKER, when set, is still the exact path (the smoke suite seam since 2026-08-16).
AL_MARKER_PREFIX="${FF_ALWAYS_LOADED_ALLOW_PREFIX:-/tmp/claude-always-loaded-allow}"
_al_session_marker() {
  local sid; sid=$(_al_payload_field session_id)
  case "$sid" in ''|*[!abcdef0123456789-]*) return 1 ;; esac   # explicit set: no locale range, no case alias on APFS
  printf '%s.%s' "$AL_MARKER_PREFIX" "$sid"
}
# REFUSE-ONLY sub-agent test: the KEY's presence, any value, anywhere — so "", null, a number, a
# pretty-printed payload or a key order that puts tool_input first all refuse. Content cannot forge it
# (JSON writes every in-string quote as \"), and a forged key could only refuse, never grant.
_al_is_subagent() { printf '%s' "${INPUT:-}" | grep -qE '"agent_id"[[:space:]]*:'; }
_al_fire() {
  ( fires_log() { :; }   # fallback: an unloadable lib degrades to NO RECORD, never to a broken deny
    . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log subagent-always-loaded-block sid "$(_al_payload_field session_id)" agent_id "$(_al_payload_field agent_id)" "$@"
  ) >/dev/null 2>&1 || true
}

deny() {
  # $1 = the reason string, already JSON-safe (see SAFE_PATH sanitization at the call site).
  # $2 = an ASCII arm SLUG for the fires log. Recording HERE rather than at each of the four call sites
  # is the structural choice: there is no other way out of this function, so a deny path added later
  # cannot forget to record, and a caller that omits the slug degrades to `unclassified` rather than to
  # silence. The slug is ASCII on purpose — the library escapes non-ASCII to \uXXXX, so an arm spelled
  # with a symbol reads ZERO under the documented `grep -cF '"arm":"<slug>"'` counting idiom.
  _al_fire arm "${2:-unclassified}" tool "${TOOL:-}" paths "${PATHS:-}" hit "${HIT:-}" bash_hit "${BASH_HIT:-}"
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "$1"
  }
}
EOF
  exit 0
}

# The instruction half of the deny reason — identical in both branches so a caller who hits the
# fail-closed path is told exactly what a caller who hits the precise path is told.
# The door printed is THIS session's own, read from the payload; with no usable session_id the deny names
# the shape instead, since no file would open the guard for such a call.
AL_DOOR=$(_al_session_marker) || AL_DOOR="/tmp/claude-always-loaded-allow.<your full session id> (this call carried no usable session_id, so no marker opens it)"
# Spliced into the deny JSON below, so strip anything that could break the document: a quote in an env-set prefix
# would otherwise give rc 0 with unparseable JSON, which the harness reads as an allow.
AL_DOOR=$(printf '%s' "$AL_DOOR" | tr -cd 'A-Za-z0-9._/ <>(),-')
WHAT_TO_DO="If you are a SUB-AGENT: do not write it. Put the proposed wording in your structured response (the '### Recommendation' / '### Memory Update' section) naming the target file and the exact text — the orchestrator holds the session context needed to judge whether it contradicts a ruling you cannot see, and applies it. If you are the ORCHESTRATOR making a deliberate rule edit: only the owner opens the door. Ask the owner to run ! touch $AL_DOOR before the batch, then rm -f it after you COMMIT: the commit tools refuse an always-loaded commit while the door is closed. That file is this session's own door; it opens nothing for any other session, and the bare /tmp/claude-always-loaded-allow no longer opens anything. Never create the marker yourself, with touch, Write, Edit or any other command, whatever the auto-mode classifier allows: that is routing around a safety control. Blocking everyone is not an oversight — CLAUDE_CODE_CHILD_SESSION is '1' for the orchestrator too, so no env var can tell the two apart; the marker is the orchestrator's door, and a call carrying agent_id (a sub-agent) is refused it."

# A SUB-AGENT IS TOLD ONLY ITS OWN ROUTE. marker_live refuses it the escape, so printing the recipe to it
# is the deny-prints-its-own-bypass anti-pattern and a
# wasted turn. The orchestrator's text above is unchanged; smoke arms pin both.
_al_is_subagent && WHAT_TO_DO="You are a SUB-AGENT (this call carries agent_id), and no escape exists for you: do not write it. Put the proposed wording in your structured response (the '### Recommendation' / '### Memory Update' section) naming the target file and the exact text; the orchestrator holds the session context to judge it, and applies it."

# ── BASH BRANCH — GRADE THE WRITE TARGET, NEVER THE MENTION ─────────────────────────────────
# ⛔⛔ DO NOT ADD A Bash MATCHER. THIS IS A DECIDED NO, NOT A PENDING NOT-YET.
#   Decided by a 7-lens review, UNANIMOUS against wiring, and adopted. The previous
#   version of this comment said the branch existed so a future wiring decision would run
#   "against a predicate that has been measured" — that reads as an endorsement, and this file
#   took three commits in ten minutes the night it was written. The measurement is the result;
#   it says no.
#
#   WHAT WAS MEASURED (each figure re-derived by at least two independent lenses):
#     · Denial rate on PRE-GUARD traffic: 1.9% (32,505 commands, 34 sessions).
#       ⚠️ TWO SAMPLES EXIST AND THEY ARE NOT THE SAME POPULATION — say which one you mean.
#       One lens replayed 34 STRATIFIED pre-guard sessions (32,505 commands) and
#       hand-read ~15 genuine writes; a separate scan read the 40 LARGEST
#       pre-guard transcripts (36,492 commands). Both are real, neither is "the" corpus, and
#       the derived per-command figures below belong to the 32,505 sample only. Written as
#       bare totals in two stores they read as a contradiction — which is how a later
#       read found this line. Cite the sample with the number, always.
#       The 18.2% first reported was the build session's own rate — the thread that writes a
#       guard is saturated with the mention-class the guard cannot distinguish.
#     · Genuine shell writes to the live corpus DO happen: ~15 in those 32,505 commands
#       (`cat >> .claude/rules/*.md <<EOF`, `sed -i '' … AGENTS.md`). ALL of them deliberate
#       orchestrator codification — zero accidents. So the guard would not be preventing
#       mistakes, it would be taxing the sanctioned workflow ~1 command in 2,167.
#     · The marker is the real coverage story: 211 commits touched always-loaded files in 10
#       days, each requiring `/tmp/claude-always-loaded-allow` — one fleet-global file with NO
#       EXPIRY AT THE TIME OF THE REVIEW, no session scope. (⚠️ The no-TTL half was true when this
#       was written at 08:59 and false 21 minutes later: one commit gave the marker a 15-minute
#       TTL — implemented in marker_live, above this comment, in this same file — and another then
#       clamped a future-dated marker. A later commit rewrote the lines immediately around this one
#       and left it standing; the argument still holds for the review's moment and must not be cited
#       as current state.) While it is up the guard is off for every seat AND every sub-agent,
#       which is the party it exists for. More denials ⇒ the marker stays up longer ⇒ the
#       branch that WORKS gets disabled. Insurance that cancels the policy you hold.
#     · A shell command names no typed target, so the predicate is undecidable in principle:
#       a path in a variable, built by concatenation, or via os.path.join is unreachable by any
#       parser. `check-memory-budget-post.sh:10-31` already decided this for the MEMORY tier —
#       measure rather than parse — and this branch
#       re-litigated it against the same evidence class and landed opposite.
#     · Wiring removes the LAST RECOVERY CHANNEL. A syntax error here exits 2, the PreToolUse
#       blocking code; this hook is already on Edit|Write|MultiEdit, so a Bash matcher would
#       leave no tool able to repair it — and the documented escape is itself a Bash command.
#       (Demonstrated accidentally on 2026-08-19: one apostrophe in a comment broke this file
#       while it was live.)
#
#   ⛔ AND "DO NOT WIRE IT" IS NOT "DELETE IT" — A SEPARATE, DECIDED QUESTION:
#   the branch STAYS, unwired. It is not dead code awaiting a cleanup pass; it is the
#   measured predicate this comment's conclusion rests on, and deleting it would leave the
#   conclusion with no artifact behind it — the next seat to rediscover the shell gap would have
#   only prose telling them a parser is not worth building, and would build one to find out.
#   That is a separate decision from the review's, because the review answered whether to WIRE and
#   was never asked whether to KEEP. If you are removing this as unreachable code: don't, and
#   nothing in the unanimous-against-wiring verdict above licenses it.
#
#   IF YOU ARE HERE BECAUSE YOU JUST REDISCOVERED THE SHELL GAP: it is real, it is known, and
#   it is not worth a command-string parser. The channel-independent controls are
#   the band checks in the source project's `.githooks/pre-push` (keyed off the git diff, so blind
#   to write verb) and the
#   write-target ledger in `always-loaded-claim-warn.sh`. Re-open only on a ledger record of a
#   genuine unmarker-guarded Bash write, or a tool that makes the shell the natural write path.
#   RE-OPEN LOG 2026-10-10: the SECOND trigger FIRED. The harness auto-mode note now tells every
#   seat, sub-agents included (measured verbatim in 21 of the 90 sub-agent transcripts of one
#   session, all among the Bash-callers), to make file changes with sed, heredocs or short scripts.
#   The FIRST trigger did NOT fire: the write ledger holds 10 records since 2026-10-09, nine of them
#   review-seat fixtures inside throwaway worktrees and one a probe, zero genuine un-marked writes to
#   the live tree. Weighed against the three reasons above, the decision was to keep the no: THE BASH
#   MATCHER STAYS UNWIRED. The Edit/Write arm's symlink gap (the walk meets ROOT by inode but reads
#   the path below it lexically) is a watch item whose trigger is a commit that wires a Bash matcher here.
#
# ⛔ WHY THE BACKSTOP CANNOT SERVE AS THE BASH GATE — MEASURED 2026-08-19, AND IT INVERTS THE
# EARLIER WRITE-UP OF THE SHELL GAP. A Bash payload carries no `file_path`, so every Bash command falls
# to the fail-closed backstop, which greps the WHOLE payload for a protected pattern. That is
# correct for an unparseable Edit payload and catastrophic for Bash, because on Bash the commonest
# command NAMING a rules file is a READ:
#
#     cat .claude/rules/bash-environment.md         -> DENIED
#     grep -n foo .claude/rules/bash-environment.md -> DENIED
#     wc -l .claude/rules/*.md                      -> DENIED
#     git diff -- .claude/rules/bash-environment.md -> DENIED
#     git log --oneline -- CLAUDE.md                -> DENIED
#     cd .claude/rules && echo x >> bash-env…md     -> ALLOWED   <- the actual write
#
# Exactly inverted: it blocks the reads and passes the write. ⚠️ The probe set that missed this was
# mine, and it was biased by construction — every "allows" case I fed it (`git status`, `npm test`,
# a `src/` grep, a `plans/` append) avoided naming a protected path, so no arm could have surfaced
# the over-block. An allow-arm that cannot fail is not evidence, and a set of them is not a set.
#
# THE PREDICATE: extract WRITE TARGETS (`>`/`>>`, `tee [-a]`, `sed -i`, `cp`/`mv` destinations),
# resolve each against the session cwd AND any `cd` in the same command, and deny only when a
# RESOLVED target lands in the protected set. Resolution is what closes the `cd` hole: the hook
# inherits the session cwd, so it sees `cd .claude/rules` in-command and a cwd already moved
# there by an EARLIER call — cwd persisted between orchestrator Bash calls until settings.json set
# CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 (2026-09-23), and does again if it is removed, which no in-command
# regex can see. Over-resolution is deliberate: a target is tested against every candidate base, so
# a `cd` appearing after the write still denies. Over-block is the safe direction here.
if [ "$TOOL" = "Bash" ]; then
  if marker_live; then exit 0; fi
  # python3 present -> precise. Absent -> fall through to the backstop, which over-blocks reads but
  # never under-blocks writes. Degrading toward the conservative arm keeps fail-closed intact.
  if command -v python3 >/dev/null 2>&1; then
    BASH_HIT=$(printf '%s' "$INPUT" | ROOT="$ROOT" python3 -c "$CONTAIN_PY"'
import json, os, re, sys
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cmd = ((p.get("tool_input") or {}).get("command")) or ""
if not cmd:
    sys.exit(0)
root = os.environ.get("ROOT") or os.getcwd()
ROOT_KEY = root_key(root)

AL = re.compile(r"(^|/)(\.claude/rules/[^/]+\.md|CLAUDE\.md|AGENTS\.md|\.claude/orchestrator/[^/]+\.md)$", re.I)

bases = [os.getcwd()]
for d in re.findall(r"(?:^|[;&|]|&&|\|\|)\s*cd\s+([^\s;&|]+)", cmd):
    d = os.path.expanduser(os.path.expandvars(d.strip("\"\x27")))
    bases.append(d if os.path.isabs(d) else os.path.join(os.getcwd(), d))

# Same containment rule as is_protected: a .claude/rules path in ANOTHER repo is not the
# always-loaded corpus of THIS repo (measured 2026-08-19: scratch worktrees and throwaway probe
# repos were being denied, which is where rules changes get rehearsed). INODE WALK, NOT A LEXICAL
# TEST, as on the Edit/Write arm: os.path.relpath against ROOT compared two SPELLINGS, and ROOT
# comes from CLAUDE_PROJECT_DIR while os.getcwd() is always physical, so a project dir spelled
# through a symlink (/tmp vs /private/tmp) read every in-repo target as ".." and ALLOWED the write
# (found in review on 2026-10-10, in a tree under /tmp).
# The walk is CONTAIN_PY above, shared with is_protected.

def protected(tok):
    tok = tok.strip("\"\x27,()")
    if not tok or tok.startswith("-"):
        return None
    tok = os.path.expanduser(os.path.expandvars(tok))
    for b in bases:
        cand = tok if os.path.isabs(tok) else os.path.join(b, tok)
        # The walk meets ROOT by inode but reads the path BELOW it lexically, so a symlink or a ".."
        # between ROOT and the target (cd lnk, lnk/x.md, lnk/../rules/x.md) is invisible to it. Test
        # the physical spellings as well: the realpath (where > and tee land) and the realpath of the parent
        # plus the literal name (what sed -i, mv and cp replace). Any spelling that lands denies.
        spellings = [cand]
        try:
            spellings += [os.path.realpath(cand),
                          os.path.join(os.path.realpath(os.path.dirname(cand)), os.path.basename(cand))]
        except Exception:
            pass
        for c in spellings:
            try:
                rel = rel_in_root(c, ROOT_KEY)
            except Exception:
                # Undecidable containment fails CLOSED: the suffix match alone decides, as the
                # Edit/Write arm does when its walk cannot prove a path is outside.
                n = os.path.normpath(c)
                if AL.search(n):
                    return n
                continue
            if rel is not None and AL.search(rel):
                return rel
    return None

# STEP 1 — explicit write targets. Deny first, with the specific reason.
targets = []
targets += re.findall(r">>?\s*([^\s;&|<>]+)", cmd)
targets += re.findall(r"\btee\s+(?:-a\s+)?([^\s;&|<>]+)", cmd)
targets += re.findall(r"\bsed\s+-i\s*(?:\x27\x27|\"\")?\s+[^;&]*?\s([^\s;&|<>]+)\s*(?:$|[;&|])", cmd)
targets += re.findall(r"\b(?:cp|mv|install|rsync)\s+(?:-[A-Za-z-]+\s+)*[^\s;&|]+\s+([^\s;&|<>]+)", cmd)
targets += re.findall(r"\bof=([^\s;&|<>]+)", cmd)
for t in targets:
    r = protected(t)
    if r:
        print("WRITE\t" + r)
        sys.exit(0)

# STEP 2 — anything else that TOUCHES a protected path must PROVE it is read-only.
# ⛔ THE ALLOWLIST IS ON THE READ SIDE ON PURPOSE. Allowlisting write verbs fails OPEN on
# every verb nobody thought of, and a shell has no closed set of ways to modify a file —
# measured: 12 of 12 (python/node/perl/dd/patch/truncate/install/rsync/git-checkout/ex/
# awk-inplace/heredoc) escaped a write-verb allowlist. The READ set is small and closed.
READ = {
    "cat","bat","head","tail","less","more","wc","grep","egrep","fgrep","rg","ugrep","ag",
    "sort","uniq","cut","tr","nl","fold","od","xxd","md5","md5sum","shasum","sha256sum",
    "stat","ls","file","diff","jq","column","echo","printf","true","test","[","cd","pwd",
    "basename","dirname","realpath","readlink","comm","join","paste","rev","strings","cmp",
}
GIT_READ = {"diff","log","show","status","blame","ls-files","grep","cat-file","rev-parse",
            "describe","shortlog","rev-list","name-rev","for-each-ref"}
# cp/mv reaching here have a NON-protected destination (step 1 cleared it), so the protected
# path is a SOURCE — a read. install/rsync are deliberately NOT here: rarer, and over-block
# is the direction chosen.
SOURCE_OK = {"cp","mv"}

def verb_of(seg):
    for w in seg.strip().split():
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w):   # env assignment prefix
            continue
        if w in ("sudo", "command", "time", "nohup", "env", "exec", "builtin", "\\"):
            continue
        return os.path.basename(w.strip("\"\x27"))
    return ""

for seg in re.split(r"\|\||&&|[;|&\n]", cmd):
    hit = None
    for tok in re.findall(r"[^\s;&|<>(),\"\x27]+", seg):
        hit = protected(tok)
        if hit:
            break
    if not hit:
        continue
    v = verb_of(seg)
    if v == "git":
        sub = ""
        parts = seg.strip().split()
        for w in parts[1:]:
            if not w.startswith("-"):
                sub = w
                break
        if sub in GIT_READ:
            continue
    elif v == "sed":
        if "-i" not in seg.split():
            continue
    elif v == "awk":
        if "inplace" not in seg:
            continue
    elif v in SOURCE_OK or v in READ:
        continue
    print("TOUCH\t" + hit + "\t" + (v or "?"))
    sys.exit(0)
' 2>/dev/null)
    if [ -n "$BASH_HIT" ]; then
      LOG_DIR="$ROOT/.claude/logs"; mkdir -p "$LOG_DIR" 2>/dev/null || true
      printf '%s BLOCKED %s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "Bash" "$BASH_HIT" \
        >> "$LOG_DIR/subagent-always-loaded-block.log" 2>/dev/null || true
      BASH_KIND=$(printf '%s' "$BASH_HIT" | cut -f1)
      BASH_PATH=$(printf '%s' "$BASH_HIT" | cut -f2 | tr -cd 'A-Za-z0-9._/ -' | cut -c1-200)
      BASH_VERB=$(printf '%s' "$BASH_HIT" | cut -f3 | tr -cd 'A-Za-z0-9._-' | cut -c1-40)
      if [ "$BASH_KIND" = "WRITE" ]; then
        deny "ALWAYS-LOADED write guard: this shell command WRITES to '$BASH_PATH', which is read by EVERY seat on its next turn. Reading these files is fine; writing them through a shell redirect is not. $WHAT_TO_DO" bash-write-redirect
      else
        deny "ALWAYS-LOADED write guard: this shell command touches '$BASH_PATH' with '$BASH_VERB', which is not on the read-only allowlist, so the guard cannot prove it is a read. Reading these files is always fine — cat, grep, head, tail, wc, diff, sed -n, and git diff/log/show/blame/ls-files all pass. If '$BASH_VERB' genuinely only reads, say so and it can be added to the allowlist; if it writes, that is what this guard is for. $WHAT_TO_DO" bash-unproven-verb
      fi
    fi
    exit 0
  else
    # ⛔ DO NOT FALL THROUGH TO THE BACKSTOP HERE (found 2026-08-19). The backstop is the
    # arm that DENIES READS — the exact defect this branch exists to remove — so on a box without
    # python3 the guard would not become "conservative", it would revert to the bug, fleet-wide,
    # in block mode, and every `cat` of a rules file would start failing. "Conservative" names the
    # DIRECTION of the error, and that direction is the one already established as intolerable.
    # So: allow, and say loudly that the gate is degraded. A missing interpreter is an
    # infrastructure fault to fix, not a licence to break every seat's reads.
    echo "always-loaded write guard: python3 is MISSING, so the Bash write-target check could not run — this shell command was NOT evaluated. The gate is DEGRADED, not enforcing. Install python3 or unwire the Bash matcher." >&2
    exit 0
  fi
fi

# ── FAIL-CLOSED BACKSTOP ────────────────────────────────────────────────────────────────────
# No path extracted, but the raw payload literally references a protected file: we cannot PROVE
# the write is safe → DENY. This is what makes the gate fail-CLOSED against a jq-absent AND
# grep-defeating payload (an escaped quote in a path, a mangled encoding, a shape we have not
# seen). It fires ONLY when a protected pattern is actually present, so an ordinary non-rules
# write with an unparseable payload still passes.
if [ -z "$PATHS" ]; then
  if printf '%s' "$INPUT" | grep -qiE "$AL_BACKSTOP"; then
    # Marker checked here too — an orchestrator bulk op must not be blocked by the backstop.
    marker_live && exit 0
    deny "ALWAYS-LOADED write guard (fail-closed): could not parse the tool payload to confirm this is a safe write, and the payload references a protected always-loaded path (.claude/rules/*.md, CLAUDE.md, AGENTS.md, .claude/orchestrator/*.md — the same set this guard's precise matcher covers). Denying conservatively. $WHAT_TO_DO" fail-closed-unparseable
  fi
  exit 0
fi

# ── PRECISE GATE ────────────────────────────────────────────────────────────────────────────
HIT=""
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if is_protected "$p"; then HIT="$p"; break; fi
done <<EOF
$PATHS
EOF

# OBSERVE-ONLY (2026-10-09): a SUB-AGENT write to a file that can
# switch a gate off is LOGGED, never denied, to its own log, so a refusal can be argued from fires.
if [ -z "$HIT" ] && _al_is_subagent && printf '%s' "${PATHS:-}" | grep -qE '(^|/)(\.claude/hooks/|\.claude/settings(\.local)?\.json$|\.githooks/)'; then
  ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log subagent-gate-file-write sid "$(_al_payload_field session_id)" agent_id "$(_al_payload_field agent_id)" arm observe tool "${TOOL:-}" paths "${PATHS:-}" ) >/dev/null 2>&1 || true
fi
# A WRITE TOOL NEVER CREATES A DOOR (2026-10-25): the door is the owner's ! touch
# (a session never creates it), and a Write/Edit/MultiEdit of it is a route the rules forbid. Basename, any case.
AL_MARKER_BASE=$(basename "$AL_MARKER_PREFIX")
# grep -i folds ASCII only; APFS also folds U+017F (long s) to s, so a casefolded copy is tested as well.
_al_names_door() { grep -qiE "(^|/)${AL_MARKER_BASE}([.][^/]*)?$"; }
if [ -z "$HIT" ] && { printf '%s\n' "${PATHS:-}" | _al_names_door || printf '%s\n' "${PATHS:-}" | python3 -c 'import sys; sys.stdout.write(sys.stdin.buffer.read().decode("utf-8", "replace").casefold())' 2>/dev/null | _al_names_door; }; then
  deny "ALWAYS-LOADED write guard: this call writes the bypass marker of this guard with a file tool. A door is opened only by the owner's ! touch. $WHAT_TO_DO" marker-write-tool
fi
[ -z "$HIT" ] && exit 0

# Bypass for deliberate orchestrator edits. FF_ALWAYS_LOADED_ALLOW_MARKER overrides the default so
# the smoke suite can exercise the bypass against a PER-PROCESS temp marker WITHOUT touching the
# live default the fleet's guard reads — otherwise every suite run (and the suite runs per-push)
# would briefly disable this guard fleet-wide (a lesson applied at birth).
if marker_live; then
  exit 0
fi

# Log the block for observability + FP/TP calibration.
LOG_DIR="${HOOK_FIRES_LOG_DIR:-$ROOT/.claude/logs}"  # the smoke suite exports it; this .log held 11,320 lines 2026-09-13..10-09 against 50 live denies in the JSONL
mkdir -p "$LOG_DIR" 2>/dev/null || true
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '%s BLOCKED %s %s\n' "$TS" "$TOOL" "$HIT" >> "$LOG_DIR/subagent-always-loaded-block.log" 2>/dev/null || true

# SHAPE-GUARD the interpolated path rather than allowlisting a field name: strip every character
# that cannot appear in a path we are willing to echo, then bound the length. A raw path carrying a
# `"` would produce INVALID JSON, and a hook emitting malformed JSON on its deny path is a hook that
# fails open exactly when it matters (`supabase.md` § shape-guarded extraction).
SAFE_PATH=$(printf '%s' "$HIT" | tr -cd 'A-Za-z0-9._/ -' | cut -c1-200)

deny "ALWAYS-LOADED write guard: '$SAFE_PATH' is read by EVERY seat on its next turn, so this edit changes what the whole fleet believes the moment it lands — there is no build step between this write and every other session. Do not Edit/Write/MultiEdit it directly. $WHAT_TO_DO" protected-path
