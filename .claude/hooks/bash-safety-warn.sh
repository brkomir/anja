#!/usr/bin/env bash
# PreToolUse(Bash) hook — warn-mode on destructive git patterns + pre-commit advisories.
#
# v2.8.2 adoption from external-vinicius91carvalho-claude.
# v2.8.6 2026-04-22: added `git commit` pre-commit advisory block
#   which closes gaps that kept leaking through
#   text-level codification.
#
# Closes the enforce-gap where memory rules (on parallel-session commits and on
# git stash) are orchestrator-memory-only and can silently
# misfire when the rule isn't loaded or isn't applied at composition time.
#
# MODE: WARN-ONLY (exit 0). Prints stderr warning when bash cmd matches
# a risky-pattern regex; never blocks. Promotion to block-mode (exit 2)
# after observation window confirms <1 FP per audit session.
#
# Patterns scanned (all git):
#   - `git add -A` or `git add .` or `git add --all` or `git add -u` / `--update` — parallel-session state risk
#   - `git commit --no-verify` — hook bypass (never skip hooks per safety protocol)
#   - `git push --force` NOT followed by `-lease` OR `--force-with-lease` — unsafe force-push
#   - `git reset --hard` — destructive (with confirmation guardrails)
#   - `git stash` — parallel-session danger
#   - `git clean -f` — destructive cleanup
#   - [PROMOTED 2026-06-29 → block-dangerous.sh] `git add $VAR` / `git commit -o $VAR` / `git rm $VAR` zsh word-split trap — graduated warn→block after the warn proved unseen
#   - `rm -rf /` — catastrophic path
#   - reader (cat/grep/od/base64/xxd/cut/dd/strings/... — anything streaming bytes
#     to stdout) OR a redirect-read (`< file`, `$(<file)`, `mapfile < file`) on a REAL
#     secret file (.env*/.envrc/*.pem/*.key/*.p12/*.pfx/*.jks/*.ppk/id_rsa/id_ed25519/
#     id_ecdsa/id_dsa/.pgpass/.netrc/.npmrc/.git-credentials/.aws/credentials/
#     service-account*.json) — secret-to-transcript leak (NEW class; templates
#     .env.example/.sample excluded). Covers readers, redirect-reads, boundary
#     chars, secret-file gaps and the jq parse.
#
# Pre-commit advisories (fire in addition to warns, always emit on `git commit`):
#   - `src/db/schema.ts` in staged diff → verify matching migration applied to staging
#   - staged diff adds `sql\`\`` template with `Date` variable → typed operator or .toISOString() cast
#
# Smoke-tested 2026-04-18: matched patterns emit warn; safe cmds silent; non-bash tool silent.

set -u

# This warn must reach the MODEL, not only the terminal: a bare-stderr PreToolUse warn is
# invisible to it (measured twice — see lib/warn-emit.sh). The inline fallback keeps this
# hook behaving exactly as before if the lib is ever missing or unreadable.
# ⛔ FALLBACK FIRST, AND ERREXIT SUSPENDED ACROSS THE SOURCE — `.` is a POSIX SPECIAL
# BUILTIN, so under `set -e` a failed source is FATAL to the shell and `|| true` CANNOT
# rescue it. Measured 2026-08-24: a corrupt lib under `set -e` / `set -euo pipefail`
# exits **rc=2** — which is the PreToolUse BLOCK code — and a missing one exits rc=1;
# in both cases execution never reaches the next line. On a matcher=Bash hook that would
# DENY EVERY BASH CALL for every seat, with the SKIP_* escape unreachable because it sits
# below the fatal line. Defining the fallback first and suspending errexit only across the
# source makes a broken lib degrade to stderr-only instead of to a fleet-wide block.
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
# ⛔ BOTH arms of this `case` assign, and the `*)` arm is LOAD-BEARING IN SIX OF THE NINE
# hooks — the ones running `set -u` WITHOUT `-e`. It reads like defensive boilerplate and
# is exactly the kind of arm a tidier deletes. Delete it and the restore line below
# dereferences an UNSET variable, `set -u` kills the hook, and this fleet-lockout FIX
# BECOMES A FLEET LOCKOUT. (A re-review confirmed the failure mode is real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

# Read hook JSON payload from stdin. Extract bash command string.
# Hook input format: {"tool_name":"Bash","tool_input":{"command":"...", ...}}
input=$(cat 2>/dev/null || echo "{}")

# Extract command. Prefer jq — it correctly unescapes an inner \" inside the command,
# whereas the naive grep below truncates the command at the FIRST inner quote, so a
# quoted secret-file path silently bypassed EVERY check below. Fall back to the grep
# parse when jq is absent (CI portability) — the prior behavior, with its weaker parse.
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

if [[ -z "$cmd" ]]; then
  exit 0
fi
# Run ledger (2026-10-09): ONE row per Bash command seen, clean included, in bash-safety-warn-fires.jsonl;
# the warn-only log below (bash-safety-fires.jsonl) stays as it was. BASH_SAFETY_NO_LOG=1 silences both.
_w1_fire() { local _r=$?; [ "${BASH_SAFETY_NO_LOG:-0}" != 1 ] || return 0; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${input:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log bash-safety-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "$([ -n "${warn:-}" ] && echo found || echo clean)" rc "$_r" ) >/dev/null 2>&1 || true; }; trap _w1_fire EXIT

# Pre-commit advisory block — fires when cmd starts with `git commit`.
# Emits independently of the $warn chain below (so a `git commit` also gets
# regular warn coverage for --no-verify etc).
if echo "$cmd" | grep -qE '^[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'; then
  advisories=""

  # schema.ts in staged diff → migration-ordering warning
  if git diff --cached --name-only 2>/dev/null | grep -qE '^src/db/schema\.ts$'; then
    advisories="${advisories}
   • src/db/schema.ts is staged — verify matching migration applied to staging DB before committing.
     Skipping the apply-before-commit order surfaces as user-facing 'column does not exist' errors.
     The runner applies only a COMMITTED file: commit the .sql alone first, then /migration <file>, then schema.ts."
  fi

  # new sql`` template with Date-typed variable in staged diff
  # Heuristic covers the real-world variable-name shapes from past bugs
  # (purgeCutoff, sevenDaysAgo, sentInterval) where the literal name "Date"
  # doesn't appear but the variable is still a Date object.
  if git diff --cached 2>/dev/null | grep -qE '^\+.*sql[[:space:]]*\`[^`]*\$\{[^}]*(new Date|Date\.now|[Dd]ate|[Tt]imestamp|Ago|Cutoff|Expires|Deadline|Interval|expiresAt|createdAt|updatedAt)[^}]*\}'; then
    advisories="${advisories}
   • staged diff contains sql\`\` template with a likely Date-typed variable — Date.toString() breaks under prepare:false.
     Fix: use typed operator (lt/gt/eq) from drizzle-orm OR explicit \${value.toISOString()}::timestamptz cast.
     Verify or suppress: grep the staged hunk; if variable is a string/number, ignore."
  fi

  if [[ -n "$advisories" ]]; then
    warn_emit < <({
      echo ""
      echo "📋 PRE-COMMIT ADVISORY (bash-safety-warn.sh — WARN-ONLY, v2.8.6):"
      echo "$advisories"
      echo ""
      echo "   Mode: warn-only (exit 0). Commit proceeds."
      echo ""
    }) || true
  fi
fi

# Pattern checks (ordered by severity — most dangerous first)
warn=""

# catastrophic rm -rf / (rare false positive)
if echo "$cmd" | grep -qE 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-rf)[[:space:]]+/([^A-Za-z0-9_.-]|$)'; then
  warn="CATASTROPHIC: \`rm -rf /\` variant detected"
fi

# git add -A / -u / --all / --update / .
# -u catches changes in tracked files (still leaks parallel-session edits in shared
# trackers, schema files, message bundles); -A also catches new files. Both banned.
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+add[[:space:]]+(-A|-u|--all|--update|\.($|[[:space:]]))'; then
  warn="git add -A/-u/--all/--update/. — parallel-session state risk. List explicit paths"
fi

# git commit --no-verify
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+commit[[:space:]].*--no-verify'; then
  warn="git commit --no-verify — bypasses pre-commit hooks. Fix underlying issue, don't skip"
fi

# git push --force WITHOUT -lease (unsafe)
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+push[[:space:]].*--force([[:space:]]|$)' && ! echo "$cmd" | grep -qE '\-\-force-with-lease|\-\-force=lease'; then
  warn="git push --force (without --force-with-lease) — unsafe; can overwrite remote. Use --force-with-lease"
fi

# git reset --hard
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+reset[[:space:]]+.*--hard'; then
  warn="git reset --hard — destructive. Confirm intent; prefer stash/branch/revert for recovery"
fi

# git stash
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+stash($|[[:space:]])'; then
  warn="git stash — parallel-session danger. Use 'git show HEAD:path' or 'git add -p' instead"
fi

# git clean -f
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+clean[[:space:]]+.*-f'; then
  warn="git clean -f — destructive. Verify what's being removed (git clean -n to dry-run first)"
fi

# git checkout <path> — reverts uncommitted changes to that path (codified 2026-05-23).
# Patterns considered dangerous:
#   - `git checkout .`                       (reverts everything in cwd)
#   - `git checkout -- <anything>`           (explicit revert form, any path)
#   - `git checkout HEAD -- <anything>`      (revert from HEAD)
#   - `git checkout <path-with-/-or-.ext>`   (path-shaped argument; branch-name false-positives accepted in warn-mode)
# Branch-switch invocations (`git checkout main`, `git checkout -b feature`) do NOT match.
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+checkout([[:space:]]+(HEAD|HEAD~[0-9]+|HEAD\^[0-9]*|[a-f0-9]{6,40}))?[[:space:]]+(\.([[:space:]]|$)|--([[:space:]]|$)|[^[:space:]\-]*[/.][a-zA-Z])'; then
  warn="git checkout <path> — REVERTS all uncommitted changes to that path. Commit/stash first if work is not yet committed. 2026-05-23: this exact pattern wiped a session's worth of chapter-by-chapter doc fixes when used to undo a synthetic-test injection. Branch switches (\`git checkout main\`, \`git checkout -b feature\`) are unaffected."
fi

# git checkout <bare-ref> — DETACHES HEAD. Deliberately a SEPARATE arm from the path-revert arm
# above, which is PATH-shaped by design (:145 excludes branch switches) and therefore SILENT on the
# exact command that detached the fleet's shared HEAD on 2026-08-13: five agents were each told
# `git checkout <sha>` with no pinned cwd, and run from the shared repo two peers' commits landed
# off-branch. Ordered AFTER the path arm so `git checkout <sha> -- <path>` keeps the revert message.
#
# WARN-MODE IS THE CEILING HERE, NOT A STAGING STEP — do NOT promote this to a block:
#   - block-dangerous.sh:49 already EXCLUDES these verbs from block-mode as "recoverable from reflog",
#     and :15 sets the block bar at "ZERO false positives ON INVOCATIONS" — measured 4/4 of the logged
#     real invocations of the sibling arms were legitimate author-intended work.
#   - the mention-class is the majority of traffic: 175 occurrences of the literal across 46 files,
#     22 at command position, and `grep -E` anchors ^ per LINE, so a documentation heredoc body is
#     byte-indistinguishable from an invocation. A DENY would block filing the incident record itself.
#   - a promotion argument must be calibrated by a seat OUTSIDE this thread: the seats that
#     built and reviewed this arm are parties.
# Re-open trigger: a SECOND shared-HEAD detachment after the prose rule ships is the evidence
# session-cadence.md asks for (contained placement tried and proved insufficient).
if [[ -z "$warn" ]] && echo "$cmd" | grep -qE 'git[[:space:]]+checkout[[:space:]]+(--detach|[0-9a-f]{7,40})([[:space:]]|$)'; then
  warn="git checkout <bare ref> — DETACHES HEAD, and on a SHARED repo that detaches it for the whole fleet (measured 2026-08-13: two peers' commits landed off-branch). Two checks first: (1) \`git rev-parse --git-dir\` vs \`--git-common-dir\` — EQUAL means you are in the shared repo, so do not switch it; (2) you probably do not need the checkout at all — worktrees share one object database, so \`git show <sha>:<path>\` reads any blob from any cwd. See .claude/rules/bash-environment.md § VERIFY YOUR OWN PLANE."
fi

# zsh word-split trap — PROMOTED to block-dangerous.sh (warn→block) 2026-06-29.
# The warn here fired but went UNSEEN (stderr the orchestrator doesn't reliably surface),
# so the bug recurred; per its promote-trigger it graduated to a
# HARD block in block-dangerous.sh (which returns the fix INTO the tool result the
# orchestrator must read). This check intentionally no longer lives here — see
# block-dangerous.sh § "zsh word-split trap".

# Secret-file read → transcript-leak warn (NEW class).
# A printing reader (cat/grep/od/base64/xxd/cut/dd/strings/... — anything that streams
# file bytes to stdout) OR a redirect-read (`< file`, `$(<file)`, `mapfile < file`) on a
# REAL secret file dumps it to stdout, which flows straight into the session transcript
# AND the model API — neither fully scrubbable, so a leaked prod credential must be
# ROTATED. Template env files (.env.example/.sample/.template/.dist) are excluded
# STRUCTURALLY — the boundary char required right after `.env[rc]` fails on a
# `.`-prefixed template suffix, so they never match. Non-reader ops with no redirect
# (ls/wc/stat/source/.) carry neither a reader token nor a `<` so they stay silent.
# Warn-only (exit 0).
# Covers reader false-negatives (od/tac/bat/nl/cut/dd/base64/hexdump/rev), the
# redirect-read bypass, the quote/paren/metachar boundary class and secret-file
# pattern gaps. Verified by ./scripts/smoke-test-hooks.sh.
_sfr_readers='cat|grep|rg|egrep|fgrep|sed|gawk|awk|head|tail|less|more|strings|xxd|printf|od|tac|bat|nl|cut|dd|base64|hexdump|rev'
# Trailing boundary after a secret filename: space/quote/paren/pipe/amp/semicolon/EOL.
_sfr_tb='([[:space:]"'\''()|&;]|$)'
# Leading boundary before a secret filename: start, or space/quote/slash/paren/pipe/amp/
# semicolon/`<`-redirect/`=`-assignment (the `<`,`=`,`(`,`)`,`'` chars were added later).
_sfr_lb='(^|[[:space:]"'\''()|&;/<=])'
# Secret-file name alternation (each alt carries its own trailing boundary _sfr_tb).
_sfr_core='\.env(rc)?(\.(local|production|development|prod|dev|staging|test))?'"$_sfr_tb"'|[^[:space:]"'\''()|&;]*\.(pem|key|p12|pfx|jks|ppk)'"$_sfr_tb"'|(id_rsa|id_ed25519|id_ecdsa|id_dsa)'"$_sfr_tb"'|\.(pgpass|netrc|npmrc|git-credentials)'"$_sfr_tb"'|\.aws/credentials'"$_sfr_tb"'|service-account[^[:space:]"'\''()|&;]*\.json'"$_sfr_tb"
# FIRE when a secret file is NAMED (gate) AND it is READ — either a reader token
# or a `<`/`$(<` redirect onto the secret file.
if [[ -z "$warn" ]] \
   && echo "$cmd" | grep -qE "$_sfr_lb($_sfr_core)" \
   && { echo "$cmd" | grep -qE "(^|[[:space:]|&;(])($_sfr_readers)([[:space:]]|\$)" \
        || echo "$cmd" | grep -qE "<[[:space:]]*['\"]?($_sfr_core)"; }; then
  warn="SECRET-FILE READ -> transcript leak risk. A printing command OR a redirect reads a live-secret file, and stdout flows straight into the session transcript + the model API (NOT fully scrubbable -- a leaked prod credential must then be ROTATED, not just deleted). Confirm NO secret VALUE reaches stdout: redact EVERY line shape incl. COMMENT lines with no 'KEY=' separator. Need only var NAMES? grep the template .env.example instead. NEW class: secret-to-transcript via env/key-file read."
fi

# `git log --author` is STRUCTURALLY BLIND on this repo -- every seat commits as the owner,
# so it cannot answer "which seat ran this commit" and returns a CONFIDENT WRONG answer
# rather than an empty one. Control reproduced independently by two seats (30/30 recent
# commits AND all unpushed = one identity); a peer measured 14 false hits off it.
# WARN, never block: the string is legitimately WRITTEN in docs and tracker rows --
# this arm only sees Bash COMMANDS, and the leading-boundary class below excludes a quoted
# mention (`grep 'git log --author' f`) because a quote is not a command boundary.
# Shipped warn-mode ahead of its FP calibration
# because a warn accrues the FP data at zero blast radius while holding produces neither
# evidence nor protection. CALIBRATED 2026-09-07 over the 50 fires then logged:
# 22 `--author-date-order`, 4 real `--author=`, 24 unreadable (cmd capped at 400 B). A first fold
# read the 22 as FALSE positives and cut them with a `[[:space:]=]` boundary; a review
# refuted that ON THE TREE: `--author-date-order` is a total NO-OP here
# (one git identity, commit-direct-to-main -- `git log --author-date-order -N` is byte-identical to
# `git log -N` at N=50 and N=2000, re-measured), and 14-16 of the 22 fires carried
# a "my commits / this session" caption: seats reaching for a seat filter and getting the whole fleet
# under a caption reading "mine" -- the CONFIDENTLY-wrong shape this arm exists for. So the 22 are
# the arm's dominant TRUE positives; the boundary is `[[:space:]=-]`, i.e. all three of git's
# `--author`-prefixed spellings (`--author=`, `--author <x>`, `--author-date-order` -- the installed
# git-log man page documents no others), and the date-order form gets its own sentence below.
# BOUNDARY FORM -- a BRACKET CLASS on purpose: the sibling arms above write `([[:space:]]|$)`, an
# alternation after a variable-width quantifier, the exact shape grep-blowup-warn.sh DENIES, so any
# Bash call quoting such a line is refused fleet-wide; a bracket class carries no alternation. Do not
# normalise it to the sibling form. The MENTION class (a quoted `git log --author` inside prose)
# still fires and no boundary addresses it.
if [[ -z "$warn" ]] \
   && echo "$cmd" | grep -qE '(^|[[:space:]|&;(])git[[:space:]]+log[[:space:]][^|;&]*--author[[:space:]=-]'; then
  warn="git log --author CANNOT ANSWER SEAT ATTRIBUTION HERE -- every session commits as the same git identity, so this filters 100% or 0% and never by seat. It fails CONFIDENTLY (a plausible wrong list), not emptily. What DOES answer it, strongest first: an in-content 'filed: <date> by <sid8>' provenance line (survives a sweep in either direction); the commit BODY; the 'Co-Authored-By' MODEL trailer (a PARTITION, never an identity -- and do NOT use it to EXCLUDE either: it stamps the model you CONFIGURED, not the one that SERVED, so 2 commits read 'Fable 5' from inside a measured 307-turn Opus 4.8 window); transcript position (one-directional -- PRESENT is evidence, ABSENT means nothing). If you need the answer rather than a guess, ASK on the mail bus -- one claim-or-disclaim beat every proxy."
  if echo "$cmd" | grep -qF -- '--author-date-order'; then
    warn="$warn AND: --author-date-order is an ORDERING flag, not a filter -- on this tree it is a total no-op (one git identity, commit-direct-to-main: its output is byte-identical to plain git log at 50 and at 2,000 commits, measured 2026-09-07), so it returns the FLEET's last N under whatever 'mine' caption you gave it."
  fi
fi

if [[ -z "$warn" ]]; then
  exit 0
fi

# FIRES LOG (added 2026-08-12) — this hook had FIVE live arms and wrote NO record of any of
# them, so every arm here was uncalibratable BY CONSTRUCTION: there was no corpus to measure a
# false-positive rate against. That is the binding constraint on any warn->block promotion
# (which needs per-incident TP/FP classification) and on any fresh-context calibrator, who
# would otherwise be dispatched to read a file that does not exist. Mirrors the shape already
# proven at `grep-blowup-warn.sh`. Best-effort; never fail the hook on a logging problem.
if [ "${BASH_SAFETY_NO_LOG:-0}" != "1" ]; then
  LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s","arm":%s,"cmd":%s}\n' "$TS" \
    "$(printf '%s' "$warn" | head -c 90 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
    "$(printf '%s' "$cmd" | head -c 400 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
    >> "$LOG_DIR/bash-safety-fires.jsonl" 2>/dev/null
fi

# Emit warn to stderr; exit 0 (warn-mode)
warn_emit < <({
  echo ""
  echo "⚠️  BASH SAFETY WARN (bash-safety-warn.sh — WARN-ONLY, v2.8.2):"
  echo "   Pattern: $warn"
  echo "   Command: $cmd"
  echo "   Mode: warn-only (exit 0). Will NOT block."
  echo ""
}) || true

exit 0
