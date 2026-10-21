#!/usr/bin/env bash
# PreToolUse(Bash) hook — HARD-BLOCK (exit 2) on catastrophic destructive ops.
#
# v2.9.0 top-priority finding from an external audit of the Claude system (2026-05-18).
# Pattern adopted from external-vinicius91carvalho-claude (their `block-dangerous.sh`,
# v1.5.2 with 23 hooks). Companion to bash-safety-warn.sh (which warns on questionable
# git patterns but does NOT hard-block — runs exit 0 always).
#
# This hook fills the GAP bash-safety-warn.sh doesn't: catastrophic UNRECOVERABLE ops.
# Where bash-safety-warn warns on `git stash` / `git add -A` (annoying but recoverable),
# block-dangerous BLOCKS on `rm -rf /` / `dd if=/dev/zero of=/dev/sd*` / fork-bombs.
#
# MODE: HARD-BLOCK (exit 2). Two classes: (1) the catastrophic patterns — WARN-MODE not
# appropriate (the warn-first discipline assumes an FP-observation window; these have
# ZERO false positives ON INVOCATIONS — nobody legitimately RUNS `rm -rf /`); (2) the zsh word-split trap —
#
# CORRECTED 2026-08-01 (this header was load-bearing-FALSE as written). The matcher
# tests the whole Bash COMMAND STRING, and the fleet's MANDATED mail form is a heredoc
# (`mail-send ... <<'EOF' ... EOF`) — so the message
# BODY is part of the command string. A body that merely QUOTES a dangerous literal is
# byte-indistinguishable from an invocation. Live instance: quoting this repo's own
# injection-fence fixture (scripts/defer-trigger-scan.py:547, which carries the literal as
# inert test DATA) hard-blocked the send.
#
# THE CORRECTION REPRODUCED ITSELF: the first attempt to write THIS comment was blocked by
# THIS hook, because the patch text quoted the literal in order to explain that quoting it
# gets blocked. It had to be assembled at runtime to land. That is the cleanest possible
# demonstration and it is why the header could not be corrected in passing.
#
# Net: zero FPs on real invocations, NON-zero on quoted DATA. Blocking is still correct — a
# matcher that tried to distinguish quoted from live WOULD BE the vulnerability. But the
# consequence belongs here: THE FLEET'S SECURITY-TEST CORPUS IS UN-QUOTABLE OVER THE
# FLEET'S OWN MAIL BUS, which is exactly the corpus a `--code` reviewer must quote verbatim.
# Describe such fixtures, or cite them by file:line — do not paste them.
# NOT catastrophic, but its warn-mode predecessor already ran its observation window and
# proved INSUFFICIENT (warn→stderr the orchestrator doesn't heed → the bug recurred
# 2026-06-29), so it graduated warn→block.
#
# Patterns that HARD-BLOCK:
#   - `rm -rf /` (or `rm -rf /*`) — wipe root filesystem
#   - `rm -rf ~` (or `rm -rf $HOME`) — wipe home directory
#   - `rm -rf .git` — destroy git history
#   - `dd if=/dev/zero of=/dev/sd*` or `of=/dev/disk*` — wipe disk
#   - `:(){:|:&};:` (and variants) — fork bomb
#   - `mkfs.*` on /dev/sd* or /dev/disk* — reformat disk
#   - `> /dev/sd*` — direct disk writes
#   - `pkill` / `pgrep` / `killall` with an option AFTER the pattern (arm `kill-option-order`,
#     2026-10-05) — not catastrophic but measured destructive: see that arm's own block
#
# What this hook does NOT block (warn-mode is sufficient):
#   - `git stash` / `git checkout <file>` / `git reset --hard` — recoverable from reflog (bash-safety-warn covers)
#   - `git push --force` — bash-safety-warn covers
#   - `rm -rf node_modules` / `rm -rf .next` / `rm -rf dist` — legitimate cleanups
#   - `npm cache clean --force` — legitimate
#
# Prevents: catastrophic parallel-session destruction (specifically:
# wiping a sibling parallel session's untracked work via a too-broad rm).
#
# Smoke-tested: 5 mock invocations (4 destructive patterns + 1 legitimate cleanup);
# all 4 destructive emit exit 2 + stderr block message; the 1 legitimate exits 0 silent.

set -u

# FIRES LOG (2026-09-13). This hook DENIES
# on three paths and kept no record of any of them, so no arm here could be calibrated — no corpus, no
# false-positive rate (session-cadence.md § READING A GUARD'S FIRES). Every deny path now calls _bd_fire
# BEFORE it emits; records land in .claude/logs/block-dangerous-fires.jsonl.
# ⛔ THE LIBRARY RUNS IN A SUBSHELL, AND EVERY VALUE AT A CALL SITE IS BRACED. Sourced in
# this shell, a library that still PARSES ended the hook before its deny: a trailing `exit 0` gave rc 0, and an
# unset read under `set -u` gave rc 1, both with nothing on either channel, which is ALLOW. `bash -n` passes
# both, and the errexit guard this function used to carry could not see them. Inside `( … )` they end only the
# child. A value expanded at a CALL SITE is evaluated before the subshell exists, so an unset one still ends
# the hook: write every value as `${v:-}` (a smoke arm REDs on a bare one). Measurements: lib/fires-log.sh
# § WHERE TO SOURCE.
# The record's sid / agent_id are THIS call's payload fields `session_id` / `agent_id` (the second only on a
# sub-agent's call), never an environment variable. They are read here on the deny path rather than beside the
# payload parse below: one jq spawn measured 2.7 ms against 24.9 ms for a whole allowed command, a cost every
# Bash call would pay for a value only a deny record reads. The no-jq branch uses the grep other hooks use.
_bd_payload_field() {
  if [ "${JQ_USED:-0}" = 1 ]; then
    printf '%s' "${input:-}" | jq -r --arg k "$1" '.[$k] // empty | tostring' 2>/dev/null
  else
    printf '%s' "${input:-}" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}
_bd_fire() {
  ( fires_log() { :; }
    . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log block-dangerous sid "$(_bd_payload_field session_id)" agent_id "$(_bd_payload_field agent_id)" "$@"
  ) >/dev/null 2>&1 || true
}

# Read hook JSON payload from stdin. Extract bash command string.
input=$(cat 2>/dev/null || echo "{}")

# Extract command. Prefer jq — it unescapes inner \" so a quoted var-assignment
# (P="…") does NOT truncate the command before a later `git add $P` (the zsh-wordsplit
# block below needs the FULL multi-line command, not a first-quote slice). Fall back to
# the naive grep when jq is absent (CI portability) — same behavior as before.
# ⛔ GATE ON WHETHER THE PARSE PRODUCED A USABLE COMMAND — NEVER ON WHETHER jq EXISTS. This read
# `JQ_USED=1` UNCONDITIONALLY until 2026-09-13, so a jq that was PRESENT but returned nothing was
# credited as a successful parse, skipped the FAIL-CLOSED tripwire below (which keys on jq being
# ABSENT), and fell to the empty-command early exit — allowing at rc=0 with no output and no record,
# in the guard whose failure is the one that cannot be undone. Any guard that copies this
# extraction owes the same gate on a usable parse.
# Measured against the real system jq: malformed rc=5, EMPTY STDIN rc=0, VALID JSON OF AN UNRECOGNISED
# SHAPE rc=0 — so rc alone is necessary and not sufficient, and the empty path is reachable with a
# perfectly healthy jq. Both conditions are required, and every other state falls through to the grep
# fallback AND the raw-payload tripwire. Emptiness is safe to gate on here because the one payload
# that legitimately has no command is the Monitor tool's `ws` form (this hook runs under `Bash`, and
# under `Monitor` once scripts/wire-monitor-guards.py has run), which the exit just below the fallback
# clears by name.
# ⛔ A NON-STRING `command` IS A STATE THE EMPTINESS GATE CANNOT SEE.
# `jq -r` pretty-prints a
# non-string, so an ARRAY `command` came back non-empty at rc=0 and was credited as a parse — measured
# ALLOW at rc=0 for an argv vector carrying a catastrophic op, while the string form denied. The OBJECT
# form still denied here, but only because a pattern below happened to match inside the pretty-printed
# text: luck, not design. So the filter is TYPE-AWARE: a string passes through, an ARRAY is JOINED with
# spaces, and every other type yields EMPTY and takes the fail-closed tripwire.
_BD_CMD_FILTER='.tool_input.command as $c | if ($c | type) == "string" then $c elif ($c | type) == "array" then ($c | map(tostring) | join(" ")) else empty end'
JQ_USED=0
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r "$_BD_CMD_FILTER" 2>/dev/null)
  [ $? -eq 0 ] && [ -n "$cmd" ] && JQ_USED=1
fi
if [ "$JQ_USED" != 1 ]; then
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi
# MONITOR'S `ws` FORM runs no shell: a Monitor input carries exactly one NON-EMPTY `command` or `ws` (a
# WebSocket watch): the tool refuses a call with both or neither at validation, before any PreToolUse hook
# runs ("exactly one of command or ws"), although its JSON schema alone would accept neither. It counts
# truthy fields, so an empty-string `command` beside `ws` is accepted and arrives here with both keys.
# Without this exit it fell to the tripwire below and denied whenever its description merely mentioned an
# op. Keyed on `ws` PRESENT and the `command` KEY absent, and cleared only by a working jq; every other
# no-command shape, an empty-string `command` beside `ws` included, still takes the tripwire (a false deny
# when its description names an op, never a missed one). Inert on a Bash payload (tool_name is set by the
# harness).
if [ "$JQ_USED" != 1 ] && command -v jq >/dev/null 2>&1 && printf '%s' "$input" | jq -e '.tool_name == "Monitor" and (.tool_input | type) == "object" and (.tool_input | has("ws")) and ((.tool_input | has("command")) | not)' >/dev/null 2>&1; then
  exit 0
fi

# FAIL-CLOSED tripwire (jq ABSENT): the grep fallback truncates $cmd at the first escaped quote
# (measured live 2026-07-13 on `echo "go" && rm -rf /`), so a catastrophic op after a quoted arg
# would be INVISIBLE. When jq is missing, match the catastrophic verb-heads against the RAW payload + DENY.
# Coarse + over-blocking is the SAFE direction for a catastrophe guard; jq is a system binary here, so this
# path is ~never taken in normal operation.
# ⛔ AND THIS HOOK HAS NO ESCAPE AT ALL — no `SKIP_*`, no `ALLOW_*` (corrected 2026-09-13). With a
# healthy jq this branch is also reached by a payload that is truncated, is not JSON, carries `tool_input`
# as a string, has no `command` key, or carries a `command` that is neither a string nor an array. An
# over-block on those shapes costs the whole command class until this hook changes, not one retry; the
# op's route is the one the deny names, by hand outside the session. Accepted, because each shape means
# the harness broke its payload contract.
# ⚠️ No arm carried a near-miss for this pattern's BREADTH until 2026-09-13; the suite now runs `rm` on a
# relative path on each degraded shape, so widening the pattern to a bare verb goes red.
# ⚠️ The deny records `payload`, the raw input cut to 400 characters by the library, and more shapes reach
# this branch since 2026-09-13. The log is gitignored and nothing reads that field; a credential inside a
# payload lands there exactly as it already lands in the session transcript, the more reachable copy.
if [ "$JQ_USED" != 1 ]; then
  if echo "$input" | grep -qE 'rm([[:space:]]+-[^[:space:]]+)+[[:space:]]+["\\]*(/|~|\$HOME|\.git)|dd[[:space:]].*of=/dev/(sd|disk|nvme)|mkfs(\.[a-z0-9]+)?[[:space:]].*/dev/(sd|disk|nvme)|:\([[:space:]]*\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\||>[[:space:]]*/dev/(sd|disk|nvme)'; then
    _bd_fire arm jq-absent-fail-closed cmd "${cmd:-}" payload "${input:-}"
    # The reason names the REAL cause. With jq INSTALLED
    # this branch is reached by a payload jq could not use — truncated, not JSON, a string tool_input, or a
    # command that is neither text nor a list — and "jq is not installed" then handed the reader a no-op first
    # remedy with the approval escape as the second. Same deny, same rc; the fires-log arm keeps its historical
    # slug so the ledger stays one series. Only the diagnosis branches.
    if command -v jq >/dev/null 2>&1; then
      cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-dangerous.sh (unparsed-payload FAIL-CLOSED): jq is installed but did not return a usable command, so the command could not be parsed reliably — the payload is truncated, is not JSON, carries tool_input as a plain string, or carries a command that is neither text nor a list. Denying because the raw payload carries a catastrophic-op signature (rm -rf on root/~/.git, dd/mkfs to a disk device, a fork bomb, or a raw disk redirect). Installing or reinstalling jq will not help; run the op manually outside this session if genuinely intended."
  }
}
JSON
    else
      cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-dangerous.sh (jq-absent FAIL-CLOSED): jq is not installed, so the command could not be parsed reliably (the grep fallback truncates at the first quote). Denying because the raw payload carries a catastrophic-op signature (rm -rf on root/~/.git, dd/mkfs to a disk device, a fork bomb, or a raw disk redirect). Install jq, or run the op manually outside this session if genuinely intended."
  }
}
JSON
    fi
    exit 2
  fi
fi

if [[ -z "$cmd" ]]; then
  exit 0
fi

# Normalize for matching: collapse whitespace, lowercase the operator words
# (preserve the rest — paths are case-sensitive on Linux).
normalized=$(echo "$cmd" | tr -s '[:space:]' ' ')

block_reason=""
# `block_arm` is each branch's ASCII slug, recorded as `arm`; the prose goes to `reason`. The prose WAS the arm
# at first: json.dumps stores its em-dash as \u2014, so the documented counting idiom
# `grep -cF '"arm":"<x>"'` read 0 on every record these seven branches wrote.
block_arm=""

# === zsh word-split trap — PROMOTED from bash-safety-warn.sh (warn→block) 2026-06-29 ===
# NOT destructive (the command just fails to stage), so it sits OUTSIDE the catastrophic
# set below — but its WARN-mode predecessor proved INSUFFICIENT: warn output goes to stderr,
# which the orchestrator does NOT reliably surface/heed, so the bug RECURRED (2026-06-29:
# `P=…; git add $P` shipped a failed `git commit` round-trip despite the warn firing —
# verified fired-but-unseen, not a regex gap). Block-mode returns the fix INTO the tool
# result the orchestrator must read — the only enforcement that reliably corrects an
# orchestrator-self-bug. FP≈0: under zsh a bare `git add $VAR` for a multi-file list NEVER
# stages; the rare single-path case just reformats. Guards: xargs / ${(f)} / ${=} /
# per-iteration loops / command-substitution `$(…)` excluded.
# COMMAND-POSITION anchored (^ | ; | & | ( | |): fires on an EXECUTED `git add $P`
# (line-start or after a separator), NOT a benign MENTION inside an echo/grep/heredoc
# string ("git add $X") — block-mode DENIES, so a mention-match is real friction (the
# broad first cut blocked the promoting session's OWN verification echo). Residual: a
# `git add $VAR` buried in a then/do clause isn't caught (rare; accepted over FP noise).
# ARG-SCOPE bounded [^|;&]* (2026-07-13): the arg match must not cross ; or & — the old
# [^|]* spanned `&&`, so a literal-path `git add f2 && … && export V="$T"` hard-blocked
# on a $VAR belonging to a LATER command (measured FP during the security consult).
if echo "$cmd" | grep -qE '(^|[;&(|])[[:space:]]*git[[:space:]]+(add[[:space:]]+[^|;&]*\$\{?[A-Za-z_]|rm[[:space:]]+[^|;&]*\$\{?[A-Za-z_]|commit[[:space:]][^|;&]*-o[[:space:]]+["]?\$\{?[A-Za-z_])' \
   && ! echo "$cmd" | grep -qE 'xargs|\$\{\(|\$\{=|;[[:space:]]*do([[:space:]]|$)|[[:space:]]done([[:space:]]|$)|while[[:space:]]|for[[:space:]]|read[[:space:]]'; then
  _bd_fire arm zsh-wordsplit cmd "${cmd:-}"
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-dangerous.sh: zsh word-split trap — a $VAR passed to git add / commit -o / rm. The Bash tool runs zsh, where $VAR (quoted OR unquoted) is ONE word (no space/newline split), so a computed file LIST becomes a single bogus pathspec and NOTHING stages, silently. Fix: list the paths explicitly inline, pipe the producer to xargs ('... | xargs git add'), or use ${(f)VAR} / ${=VAR}; verify with 'git diff --cached --name-only'. Promoted warn->block 2026-06-29 (the warn fired to stderr but went unseen)."
  }
}
JSON
  exit 2
fi

# === HARD-BLOCK PATTERNS ===

# 1. rm -rf / or rm -rf /* (wipe root)
# FLAG-REGEX BROADENED (2026-07-13): the old (-[a-zA-Z]*r...f...) needed r AND f in ONE
# token, so separated `rm -r -f /` and long `rm --recursive --force /` bypassed. Now `([[:space:]]+-<flag>)+`
# accepts any run of flag tokens (separated or combined, short or long); a bare `rm /file` (no flag) still
# ALLOWs. TERMINATOR ([^[:alnum:]._~/-]|$) admits a trailing quote/;/& (`eval "rm -rf /"`); `["]?` before
# the target admits a quoted root (`rm -rf "/"`). Still distinguishes root from a real path (`rm -rf /tmp`
# — alnum after / — ALLOWs). All measured live.
if echo "$normalized" | grep -qE '\brm([[:space:]]+-[^[:space:]]+)+[[:space:]]+["]?(/|/\*)([^[:alnum:]._~/-]|$)'; then
  block_reason="rm -rf on root filesystem (/) — wipes entire system. If you meant a specific subdirectory, name it explicitly."
  block_arm=root-wipe
fi

# 2. rm -rf ~ or rm -rf $HOME (wipe home)
if [[ -z "$block_reason" ]] && echo "$normalized" | grep -qE '\brm([[:space:]]+-[^[:space:]]+)+[[:space:]]+(~|\$HOME|"\$HOME"|~/)[[:space:]]*([[:space:]]|$)'; then
  block_reason="rm -rf on home directory (~ or \$HOME) — wipes all user files including untracked work in parallel sessions. Name a specific subdirectory."
  block_arm=home-wipe
fi

# 3. rm -rf .git (destroy git history)
if [[ -z "$block_reason" ]] && echo "$normalized" | grep -qE '\brm([[:space:]]+-[^[:space:]]+)+[[:space:]]+\.git([[:space:]]|/|$)'; then
  block_reason="rm -rf .git — destroys entire git history irreversibly. If you need a fresh repo, use 'rm -rf .git/index' for index only, or 'git rm --cached' for specific files."
  block_arm=git-history-wipe
fi

# 4. dd writing to /dev/sd* or /dev/disk* (disk wipe)
if [[ -z "$block_reason" ]] && echo "$normalized" | grep -qE '\bdd[[:space:]]+.*of=/dev/(sd[a-z]|disk[0-9]|nvme[0-9])'; then
  block_reason="dd writing to physical disk device — wipes drive contents. Confirm device path is intended and run outside this session."
  block_arm=dd-to-disk
fi

# 5. Fork bomb (:(){:|:&};: and variants)
if [[ -z "$block_reason" ]] && echo "$cmd" | grep -qE ':\([[:space:]]*\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:[[:space:]]*&[[:space:]]*\}[[:space:]]*;[[:space:]]*:'; then
  block_reason="fork bomb detected — exhausts process table, requires reboot."
  block_arm=fork-bomb
fi

# 6. mkfs on /dev/sd* (reformat disk)
# `([^[:space:]]+[[:space:]]+)*` (was `.*[[:space:]]+`) so a device IMMEDIATELY after mkfs — `mkfs.ext4
# /dev/sda`, one space, no interposed token — still fires (the old `.*[[:space:]]+` required a token
# between mkfs and the device). Measured live.
if [[ -z "$block_reason" ]] && echo "$normalized" | grep -qE '\bmkfs(\.[a-z0-9]+)?[[:space:]]+([^[:space:]]+[[:space:]]+)*/dev/(sd[a-z]|disk[0-9]|nvme[0-9])'; then
  block_reason="mkfs on physical disk device — reformats drive. Confirm device path is intended and run outside this session."
  block_arm=mkfs-on-disk
fi

# 7. Direct redirect to /dev/sd* (disk write)
if [[ -z "$block_reason" ]] && echo "$normalized" | grep -qE '>[[:space:]]*/dev/(sd[a-z]|disk[0-9]|nvme[0-9])'; then
  block_reason="redirect to physical disk device — overwrites raw disk. Confirm device path and run outside this session."
  block_arm=raw-disk-redirect
fi

# === EMIT BLOCK OR PASS ===

if [[ -n "$block_reason" ]]; then
  _bd_fire arm "${block_arm:-}" reason "${block_reason:-}" cmd "${cmd:-}"
  # Emit structured deny per Claude Code hook protocol (permission denial).
  # Hook spec: emit JSON to stdout with permissionDecision='deny' + message.
  # The model SEES this and can ask for confirmation OR re-approach.
  cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-dangerous.sh: $block_reason\n\nThis hook is hard-block (exit 2) — pattern is catastrophic with no false positives in normal dev. If you genuinely intend this op, run it manually outside this session.\n\nPrevents parallel-session destructive cleanup."
  }
}
JSON
  exit 2
fi

# === kill-option-order (2026-10-05) — pkill / pgrep / killall with an option AFTER its pattern ===
# macOS ships the BSD tools, whose option parsing STOPS at the first pattern, so every later `-x` is
# matched as one more PATTERN and its limit never applies. A sub-agent's `pkill -f 'cat' -U $(id -u) -n`
# SIGTERMed 36 logged launchd jobs in one second — Chrome, every other iTerm tab and four Claude
# sessions — because 'cat' is inside '/Applications/' and '501' inside every claude-501 tmp path.
# ⛔ A PARSER, NOT A REGEX OVER THE STRING: the matchers above test the raw command, and this file's
# header records that they therefore block a mail or commit message that merely QUOTES their pattern.
# For this class that would block every write-up of the incident, so lib/kill-option-order.py checks
# COMMAND POSITION only (quoted strings, comments and heredoc bodies are mentions, unless a shell
# reads the heredoc as its script) and descends into
# $( ), backticks, `sh -c`, eval, sudo/env/xargs. Corpus replay before shipping: 908 real invocations
# across every transcript on this box, 4 fires, all 4 the true shape (the incident + 3 deliberate
# reproductions), 0 on the 203 commands that only mention a kill tool.
# ⚠️ FAILS OPEN ON A HELPER FAILURE — and records it. Any rc other than 0/3 (python3 missing, a crash,
# or rc 4: a line naming a kill tool that the parser could not read, or text too large to parse)
# lets the command through with an `arm=kill-option-order-helper-failed` record: this class is
# destructive but recoverable, and failing closed would deny every `pgrep` wait loop in the fleet on a
# broken helper. The pre-filter below means only commands containing a tool name pay the python spawn.
case "$cmd" in
  *pkill*|*pgrep*|*killall*)
    # jq broken -> $cmd came from the grep fallback, which mangles quoted and multi-line commands,
    # so a clean helper verdict below is not a real one; record that the arm ran blind.
    [ "$JQ_USED" = 1 ] || _bd_fire arm kill-option-order-unparsed cmd "${cmd:-}"
    _bd_koo_out=$(printf '%s' "$cmd" | python3 "$(dirname "${BASH_SOURCE[0]}")/lib/kill-option-order.py" 2>/dev/null)
    _bd_koo_rc=$?
    if [ "$_bd_koo_rc" -eq 3 ] && [ -n "${_bd_koo_out:-}" ]; then
      _bd_fire arm kill-option-order cmd "${cmd:-}"
      printf '%s\n' "${_bd_koo_out:-}"
      exit 2
    elif [ "$_bd_koo_rc" -ne 0 ]; then
      _bd_fire arm kill-option-order-helper-failed rc "${_bd_koo_rc:-}" cmd "${cmd:-}"
    fi
    ;;
esac

exit 0
