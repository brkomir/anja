#!/usr/bin/env bash
# PreToolUse(Bash) hook — HARD-BLOCK (exit 2) pushes + CI-triggering commands
# unless the owner has explicitly approved THIS action (ALLOW_PUSH=1 prefix).
#
# HARD RULE: never `git push` or trigger a CI/Actions run without explicit per-action approval.
# Context: a single /fix session burned most of the monthly Actions-minutes allowance via
# repeated direct pushes + a Dependabot rebase/recreate/auto-merge cascade. CI here is
# the FULL Tests suite (a long, billable run per push);
# deploy is CI-gated. So each unapproved push is real money + risks blocking deploys.
#
# MODE: HARD-BLOCK (exit 2). This is a deliberate speed-bump, not an absolute lock —
# when the owner approves, re-run the command with an `ALLOW_PUSH=1 ` prefix and it
# passes. The point is to make every push/CI-trigger a CONSCIOUS, owner-sanctioned
# 2-step action instead of a reflex. Mirrors block-dangerous.sh's deny protocol.
#
# BRANCHING POLICY: only what can
# reach PRODUCTION stays owner-gated. `main` moves by a merged pull request (the merge is the
# gated act) or a hotfix push; `dev` and feature branches deploy to the private test plane or a
# login-walled preview, and sessions push them at their own discretion, sparingly, since every
# push costs time — WHEN a session pushes `dev` was later narrowed to
# /wrap's optional last step or the owner's ask (doctrine only; this hook still allows it as typed). Opening a PR is session-discretion for the same
# reason. So a `git push` is classified by its TARGET, resolved from the refspec — and, for a bare
# `git push` / `git push origin` / `origin HEAD`, from the CURRENT BRANCH via git (FAIL-CLOSED:
# a hotfix worktree sitting on main carries no `main` token in the command, and a text-only
# narrowing would have let it through).
#
# BLOCKS (only these — everything else exits 0 SILENT, zero noise on normal work):
#   - git push … main / …:main / refs/heads/main   (production deploy)
#   - git push (bare) / git push origin / origin HEAD  WHEN the current branch is main, or
#     when the branch cannot be resolved (fail-closed)
#   - git push --force|-f|--force-with-lease|--delete|-d|--mirror|--all  (can rewrite or delete main)
#   - gh pr merge                    (merges into main -> production deploy)
#   - gh pr reopen                   (re-fires the PR CI run)
#   - gh pr comment                  (the common use here is `@dependabot rebase/merge`,
#                                     each of which fires a fresh CI run; grep can't see
#                                     inside a quoted --body, so the whole verb is gated)
#   - gh run rerun                   (re-runs a workflow)
#   - gh workflow run                (manual dispatch)
#   - a git push whose refspec carries a `$` (a variable or substitution: `git push origin "$SRC"`) —
#     the guard reads the literal token, so it cannot tell where it points; fail-closed (a review
#     found `$SRC` classified as a branch name and a push to main ALLOWED)
#   - gh api writes (-X/--method other than GET, or -f/-F/--field/--raw-field/--input, which make it
#     a POST) to a PR-merge, branch-protection, ruleset, workflow-dispatch, run-rerun or repo-settings
#     endpoint, or a graphql merge/auto-merge/protection mutation — the same acts as the verbs above,
#     reached through the REST API (same review). A GET read passes.
#
# Does NOT block (free / read-only — silent pass): git status|log|diff|fetch|add|commit|
# checkout|rebase (local), gh pr view|list|checks|diff, gh run view|list, npm, etc.
#   - git push origin dev / -u origin dev / origin feat/x / origin HEAD:refs/heads/dev
#     (the test plane and previews — no token; WHEN is the /wrap-or-owner-ask rule)
#   - gh pr create                   (opens the promote PR; the MERGE stays gated)
#
# Escape: prefix the command with `ALLOW_PUSH=1 ` (e.g. `ALLOW_PUSH=1 git push origin main`)
# AFTER the owner says go. The hook sees the marker in the command string and passes.

set -u

input=$(cat 2>/dev/null || echo "{}")

# Extract the bash command string. Prefer jq — it unescapes inner \" so a quoted
# arg BEFORE the push verb (`git commit -m "msg" && git push`, the most common real
# composition) does NOT truncate the command at the first escaped quote. The naive
# grep extraction did exactly that, so the gate SILENTLY PASSED any push preceded
# by a quote (measured bypass, 2026-07-13). Mirrors
# block-dangerous.sh's jq-first extraction; grep fallback kept for portability.
# ⛔ GATE ON THE PARSE'S EXIT CODE, NEVER ON jq'S PRESENCE — THIS READ `JQ_USED=1` UNCONDITIONALLY
# UNTIL 2026-09-13 AND THAT WAS A FAIL-OPEN ON THE ONE RULE THE FLEET TREATS AS ABSOLUTE.
# The old shape asked "is jq installed?" and never "did the parse work?". A jq that is PRESENT but
# FAILS returned empty, was credited as a successful parse, skipped the fail-closed tripwire below
# (which keys on `JQ_USED != 1`), and fell to the `[[ -z "$cmd" ]] && exit 0` early exit — so a
# `git push` payload was ALLOWED at rc=0 with zero output, the `2>/dev/null` hiding the cause.
# Measured 2026-09-13, three arms with a positive control on the rig itself: real jq -> rc=2 DENY ·
# jq ABSENT -> rc=2 DENY · jq PRESENT BUT BROKEN -> rc=0 ALLOW. Found by a sub-agent enumerating the
# deny paths, reproduced independently, confirmed at source.
# ⛔ AND THE EXIT CODE ALONE IS NECESSARY BUT NOT SUFFICIENT — CORRECTED 2026-09-13, HOURS AFTER THE
# FIX ABOVE, WHEN A REVIEW LENS MEASURED THE HOLE IT LEAVES. This block read "THE EXIT CODE IS THE
# ONLY DISCRIMINATOR HERE, AND EMPTINESS IS NOT", on the stated ground that an emptiness-keyed guard
# would over-block every non-Bash tool call. ⛔ THAT GROUND IS FALSE: this hook AND block-dangerous.sh
# are registered under the `Bash` matcher (and `Monitor`, once scripts/wire-monitor-guards.py has run)
# ONLY, so a Read, Edit or Glob payload never reaches either of them and the over-blocking being
# avoided CANNOT HAPPEN; Monitor's `ws` form, the one legitimate no-command payload, is cleared by name
# just above the tripwire. Measured
# against the real system jq, four arms: malformed input rc=5 (the one arm the exit-code gate closes),
# EMPTY STDIN rc=0, and VALID JSON OF AN UNRECOGNISED SHAPE rc=0. So an empty extraction at rc=0
# credited the parse, skipped the tripwire and reached the allow WITH A PERFECTLY HEALTHY jq — no
# broken binary required, only a renamed or re-nested command key. The flag now requires BOTH rc=0 AND
# a non-empty extraction; every other state falls through to the grep fallback and the raw tripwire.
# Both failure modes (absent, failed) now converge on the SAME state: JQ_USED stays 0, the grep
# fallback populates $cmd, and the fail-closed tripwire below runs.
# ⛔ A NON-STRING `command` IS A STATE THE EMPTINESS GATE CANNOT SEE (a review verdict).
# `jq -r` PRETTY-PRINTS a non-string, so `.tool_input.command // empty` over an ARRAY or
# an OBJECT came back non-empty at rc=0: the parse was credited, the raw tripwire skipped, and the
# command-position match below cannot see a verb wrapped in JSON punctuation. Measured: ALLOW at rc=0 for
# both shapes carrying a push, while the same command as a string denied. The renamed and re-nested cases
# were closed; the re-TYPED one was not, and an argv vector is the obvious future shape for this field.
# So the filter is TYPE-AWARE: a string passes through; an ARRAY is JOINED with spaces, so the precise
# match reads it as the command it is and an argv that opens with `ALLOW_PUSH=1` still escapes; every
# other type yields EMPTY and takes the fail-closed path. ⚠️ A type guard ALONE is not the fix — the
# review lens ran it: it routes the object form to the tripwire and leaves the array form ALLOWING,
# because the raw bytes separate the tokens with `","` and the tripwire cannot match across them.
_PG_CMD_FILTER='.tool_input.command as $c | if ($c | type) == "string" then $c elif ($c | type) == "array" then ($c | map(tostring) | join(" ")) else empty end'
JQ_USED=0
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r "$_PG_CMD_FILTER" 2>/dev/null)
  [ $? -eq 0 ] && [ -n "$cmd" ] && JQ_USED=1
fi
if [ "$JQ_USED" != 1 ]; then
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# The block verbs as one alternation — used ONLY by the fail-closed raw tripwire below, on $input. The
# precise command-position match further down builds its own per-verb patterns from POS. (This read
# "used for BOTH" until 2026-09-13; a grep finds exactly this definition and the tripwire.)
# ⚠️ ITS BREADTH WAS AN AXIS NO ARM COULD SEE until 2026-09-13: widened to a bare verb, the suite stayed
# 1,400 of 1,400 green (relayed: the review lens's mutation). The suite's near-miss arms now carry the
# verb WORD without its head on every degraded shape, so a widening goes red. Loosen it only with those
# arms in view.
VERBS='git[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+merge|gh[[:space:]]+pr[[:space:]]+(create|reopen)|gh[[:space:]]+pr[[:space:]]+comment|gh[[:space:]]+run[[:space:]]+rerun|gh[[:space:]]+workflow[[:space:]]+run'

# FIRES LOG — THE SECOND DENY PATH (2026-09-13). This hook has TWO deny paths and only the lower one
# recorded: the `reason` branch writes INLINE (grep push-guard-fires.jsonl below), while the jq-absent
# FAIL-CLOSED branch directly beneath this comment recorded NOTHING. That is the arm a calibrator most
# needs, because it is the one that fires when the parser is degraded and the deny rests on a RAW-payload
# match — precisely the fires whose true/false split nobody can guess. It now records through the shared
# library, under the SAME `push-guard` stem, so both paths land in one ledger.
# ⛔ THE LIBRARY IS SOURCED IN A SUBSHELL, AND EVERY VALUE AT A CALL SITE IS BRACED. Sourced in this
# hook's own shell, a library that still PARSES can end the hook before its deny — a trailing `exit 0`
# gives rc 0, an unset read under `set -u` gives rc 1, both with nothing on either channel, which is
# ALLOW on a PreToolUse hook. `bash -n` passes both shapes. Inside `( … )` they end only the child.
# A value expanded at a CALL SITE is evaluated before the subshell exists, so an unset one still ends the
# hook: write every value as `${v:-}`. Mechanism + measurements: lib/fires-log.sh § WHERE TO SOURCE.
# The record's sid / agent_id are THIS call's PAYLOAD fields, never an environment variable — with the
# env-var form an unset variable does not mislabel the record, it loses the deny. The extractor is the
# grep form rather than block-dangerous.sh's jq-first one BY CONSTRUCTION: the only caller below is the
# branch reached when jq is absent or broken, where a jq-first helper could only take this branch anyway.
_pg_payload_field() {
  printf '%s' "${input:-}" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}
_pg_fire() {
  ( fires_log() { :; }   # fallback: an unloadable lib degrades to NO RECORD, never to a broken deny
    . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
    fires_log push-guard sid "$(_pg_payload_field session_id)" agent_id "$(_pg_payload_field agent_id)" "$@"
  ) >/dev/null 2>&1 || true
}

# FAIL-CLOSED tripwire (jq ABSENT): the grep fallback truncates $cmd at the first escaped quote — the
# bypass was fixed on the jq path only; the fallback still carries it (measured live
# 2026-07-13, jq-absent). So when jq is missing we cannot trust $cmd: match the verbs against the RAW
# payload and DENY. Over-blocking a prose mention is the SAFE direction for a gate whose whole job is
# to stop pushes; jq is a system binary here, so this path is ~never taken in normal operation.
# ⛔ AN OVER-BLOCK HERE DOES NOT COST "ONE RETRY" (corrected 2026-09-13). With a healthy jq this
# branch is also reached by a payload that is truncated, is not JSON, carries `tool_input` as a string,
# has no `command` key, or carries a `command` that is neither a string nor an array. The ALLOW_PUSH
# escape just below matches the raw bytes `"command":"ALLOW_PUSH=1 `, so it survives only where that
# key-value pair does — measured 2026-09-13: truncated ALLOWS with the prefix; a string `tool_input`,
# not-JSON and an object `command` all DENY with it. On those shapes no seat can escape an approved push
# from inside a session: it costs the whole push class until this hook changes, or the owner pushes from
# their own terminal. Accepted, because each shape means the harness broke its payload contract.
# ⛔ Do NOT widen the escape to "any JSON string value that starts with the marker": a Bash tool input
# also carries a model-written `description` (34 of 34 sampled calls, 2026-09-13), so that widening lets
# a description approve a push.
# ⚠️ The deny below records `payload`, the raw input cut to 400 characters by the library, and more
# shapes reach this branch since 2026-09-13 than before. The log is gitignored and nothing reads that
# field; a credential inside a payload lands there exactly as it already lands in the session transcript,
# which is the more reachable copy.
# MONITOR'S `ws` FORM runs no shell: a Monitor input carries exactly one NON-EMPTY `command` or `ws` (a
# WebSocket watch): the tool refuses a call with both or neither at validation, before any PreToolUse hook
# runs ("exactly one of command or ws"), although its JSON schema alone would accept neither. It counts
# truthy fields, so an empty-string `command` beside `ws` is accepted and arrives here with both keys.
# Without this exit it fell to the tripwire below and denied whenever its description merely mentioned a
# verb. Keyed on `ws` PRESENT and the `command` KEY absent, and cleared only by a working jq; every other
# no-command shape, an empty-string `command` beside `ws` included, still takes the tripwire (a false deny
# when its description names a verb, never a missed one). Inert on a Bash payload (tool_name is set by
# the harness).
if [ "$JQ_USED" != 1 ] && command -v jq >/dev/null 2>&1 && printf '%s' "$input" | jq -e '.tool_name == "Monitor" and (.tool_input | type) == "object" and (.tool_input | has("ws")) and ((.tool_input | has("command")) | not)' >/dev/null 2>&1; then
  exit 0
fi
if [ "$JQ_USED" != 1 ]; then
  # Honor the escape ONLY when ALLOW_PUSH is at the START of the command VALUE — an unanchored raw
  # match let a quoted/prose ALLOW_PUSH mention approve a real push (a fail-OPEN in the fail-closed
  # path). Anchor to the command-value prefix, mirroring the jq-present command-position discipline.
  if echo "$input" | grep -qiE '"command"[[:space:]]*:[[:space:]]*"ALLOW_PUSH=1[[:space:]][^;&|(`\\]*("|$)'; then exit 0; fi   # one segment only, as on the parsed path
  if echo "$input" | grep -qE "$VERBS"; then
    _pg_fire arm jq-absent-fail-closed cmd "${cmd:-}" payload "${input:-}"
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
    "permissionDecisionReason": "BLOCKED by block-push-without-approval.sh (unparsed-payload FAIL-CLOSED): jq is installed but did not return a usable command, so the command could not be parsed reliably — the payload is truncated, is not JSON, carries tool_input as a plain string, or carries a command that is neither text nor a list. Denying because the raw payload contains a push / CI-trigger verb. Installing or reinstalling jq will not help. If the owner approved THIS push, re-run with an 'ALLOW_PUSH=1 ' prefix; it is honored only where the raw payload still carries it at the start of the command value, and otherwise the owner runs the push from their own terminal."
  }
}
JSON
    else
      cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-push-without-approval.sh (jq-absent FAIL-CLOSED): jq is not installed, so the command could not be parsed reliably (the grep fallback truncates at the first quote — the bypass class). Denying because the raw payload contains a push / CI-trigger verb. Install jq for precise matching, or — if the owner approved THIS push — re-run with an 'ALLOW_PUSH=1 ' prefix."
  }
}
JSON
    fi
    exit 2
  fi
fi

[[ -z "$cmd" ]] && exit 0

# PROTOTYPE (UNTESTED HYPOTHESIS vs the repo smoke suite).
# (a) A backslash-newline is ONE command to the shell; join it before any line-oriented match.
cmd="$(printf '%s' "$cmd" | LC_ALL=C awk '{ if (sub(/\\$/, "")) printf "%s", $0; else printf "%s\n", $0 }')"   # removed, as bash removes it; linear (bash ${//} is quadratic in the match count)

# Approval escape — owner has sanctioned THIS action. COMMAND-POSITION anchored
# (start of command/line or after ; & |): a quoted MENTION of the marker inside
# another command (`echo "ALLOW_PUSH=1 …" && git push`) must NOT count as
# approval (2026-07-13 — the old \b match accepted the marker anywhere).
# The marker approves ONLY the segment it prefixes: blank that segment, classify the rest.
cmd_ctx="$cmd"   # the cd / GIT_DIR / checkout evidence survives the marker's blanking
cmd="$(printf '%s' "$cmd" | sed -E 's/(^|[;&|][[:space:]]*)ALLOW_PUSH=1[[:space:]][^;&|(`]*/\1:/g')"   # stops at $( and ` : a nested command is its own segment

# (b) command position also after a reserved word, a `{` / `!`, any run of VAR=val (the fleet's own
# push spelling is `SKIP_X=1 git push …`), a wrapper, and a path prefix on the binary. NOT after a backtick:
# markdown code spans in commit/mail heredocs then read as commands (measured: this fold's own message denied).
# (b, cont.)
# assignments, a wrapper (env/nohup/command/exec/sudo/nice/time/caffeinate), and a path prefix on the binary.
_SEP='(^[[:space:]]*|[;&|({!][[:space:]]*|eval[[:space:]]+["'"'"']?|(bash|sh|zsh)([[:space:]]+-[[:alnum:]]+)*[[:space:]]+-[[:alnum:]]*c[[:alnum:]]*[[:space:]]+["'"'"']?|xargs([[:space:]]+-[^[:space:]]+)*[[:space:]]+)'
_RSV='((then|do|else|elif|if|while|until|time|!)[[:space:]]+)*'
_ASG='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
_WRP='(([^[:space:];&|()`]*/)?(env|nohup|command|exec|sudo|nice|time|caffeinate|builtin|timeout|stdbuf)([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?|[[:space:]]+[0-9][^[:space:]]*)*[[:space:]]+'"${_ASG}"')*'
POS="${_SEP}${_RSV}${_ASG}${_WRP}"'([^[:space:];&|()`]*/)?'
GITHEAD="${POS}git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push"
GITPUSH="${GITHEAD}([^[:alnum:]_-]|\$)"
GHF='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
reason=""
_pg_tail_pre=""

cur_branch() { git symbolic-ref --short -q HEAD 2>/dev/null || true; }
# Strip quotes; INSIDE a quoted span blank whitespace and shell metacharacters to %, so a quoted '#x' or '>'
# is a word (not a comment or redirection) and a quoted ' -X GET' is not a flag.
_pg_unquote() { printf '%s' "$1" | LC_ALL=C awk '{o="";q="";n=length($0);for(i=1;i<=n;i++){c=substr($0,i,1);if(q=="\047"){if(c==q){q="";continue};if(c ~ /[[:space:]#<>;&|()]/)c="%"}else if(q=="\""){if(c=="\\"&&i<n&&index("\"\\$`",substr($0,i+1,1))>0){i++;c=substr($0,i,1)}else if(c==q){q="";continue};if(c ~ /[[:space:]#<>;&|()]/)c="%"}else if(c=="\\"&&i<n){i++;c=substr($0,i,1);if(c ~ /[[:space:]#<>;&|()]/)c="%"}else if(c=="\""||c=="\047"){q=c;continue};o=o c};if(q!="")o=o " %UNBALANCED%";printf "%s",o}'; }
_QW='(\\.|[^;&|)\\'"'"'"]|'"'"'[^'"'"']*('"'"'|$)|"([^"\\]|\\.)*("|$))'   # an escaped char, one unquoted char, or one quoted span (unclosed runs to end of line)
# (c) EVERY command-position push segment is classified, not the first unanchored match.
if echo "$cmd" | grep -qE "$GITPUSH"; then
  worst="other"; nseg=0
  while IFS= read -r seg; do
    [ -n "$seg" ] || continue
    nseg=$((nseg+1))
    [ "$nseg" -gt 100 ] && { worst="cap"; break; }   # bounded: a timed-out hook is an ALLOW
    gitflags="$(printf '%s' "$seg" | sed -E 's/[[:space:]]push([^[:alnum:]_.=-].*)?$//')"
    args="${seg:${#gitflags}}"; args="${args#*push}"      # the VERB, never the last " push"-prefixed word (> push.log, # push)
    args="$(_pg_unquote "$args")"
    target="other"; force=0; remote=""; refspecs=""
    case "$args" in *'`'*|*'$'*|*%UNBALANCED%*) target="unknown" ;; esac     # substitution anywhere in the args, or a quote left open at end of line
    set -f; skipnext=0
    for tok in $args; do
      [ "$skipnext" = 1 ] && { skipnext=0; continue; }
      case "$tok" in '#'*) break ;; esac                      # a comment ends the command
      case "$tok" in *'>'*|*'<'*)                             # a redirection is not a refspec (> push.log)
        case "$tok" in '>'|'>>'|[0-9]'>'|[0-9]'>>'|'<'|'&>'|'&>>') skipnext=1; continue ;; esac
        tok="${tok%%[<>]*}"; case "$tok" in ''|[0-9]|'&') continue ;; esac ;;   # keep a word glued before it: HEAD:main<in
      esac
      case "$tok" in
        -f|--force|--force-with-lease|--force-with-lease=*|--force-if-includes|-d|--delete|--mirror|--all|--branches|--prune) force=1 ;;
        -*) : ;;
        *) if [ -z "$remote" ]; then remote="$tok"; else refspecs="$refspecs $tok"; fi ;;
      esac
    done
    # a -C / --git-dir / --work-tree / -c on git, or a `cd` anywhere in the command, moves the repo the
    # push reads away from the hook's cwd: the current-branch lookup below would answer for the WRONG repo.
    elsewhere=0
    printf '%s' "$gitflags" | grep -qE '[[:space:]](-C|-c|--git-dir|--work-tree)([[:space:]=]|$)' && elsewhere=1
    printf '%s' "$cmd_ctx" | grep -qE "${POS}(cd|pushd)[[:space:]]" && elsewhere=1
    printf '%s' "$cmd_ctx" | grep -qE 'GIT_(DIR|WORK_TREE)=' && elsewhere=1
    printf '%s' "$cmd_ctx" | grep -qE "${POS}git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(checkout|switch)([[:space:]]|\$)" && elsewhere=1
    if [ "$force" = 1 ]; then
      target="main"
    elif [ "$target" = "unknown" ]; then
      :
    elif [ -z "$refspecs" ]; then   # never "${refspecs// /}": bash ${//} is quadratic in the match count (8,000 words > 90 s = a timed-out hook)
      cur="$(cur_branch)"
      if [ "$elsewhere" = 1 ] || [ -z "$cur" ] || [ -n "$(git config --get-all "remote.${remote:-origin}.push" 2>/dev/null)" ]; then target="unknown"
      elif [ "$cur" = "main" ]; then target="main"; fi
    else
      for rs in $refspecs; do
        rs="${rs#+}"
        case "$rs" in :*) target="main"; break ;; esac   # an empty source DELETES the destination, like --delete
        case "$rs" in *'$'*|*'*'*|*'{'*|*'\'*|*'?'*|*'['*) target="unknown"; break ;; esac
        dst="${rs##*:}"; d="${dst#refs/}"; d="${d#heads/}"
        case "$d" in
          main) target="main" ;;
          HEAD|@) cur="$(cur_branch)"; if [ "$elsewhere" = 1 ] || [ -z "$cur" ]; then target="unknown"; elif [ "$cur" = "main" ]; then target="main"; fi ;;
        esac
      done
    fi
    set +f
    case "$target" in
      main) worst="main" ;;
      unknown) [ "$worst" = "main" ] || worst="unknown" ;;
    esac
  done <<< "$(printf '%s' "$cmd" | grep -oE "${GITHEAD}([[:space:]]${_QW}*)?")"
  [ "$nseg" -gt 0 ] || worst="unknown"     # matched but nothing extracted: the parser is wrong, fail closed
  if [ "$worst" = "main" ]; then reason="git push"
  elif [ "$worst" = "cap" ]; then reason="git push (more than 100 push segments in one command — too many to classify inside the hook's time budget, fail-closed; split the command)"
  elif [ "$worst" = "unknown" ]; then reason="git push (target branch could not be resolved — fail-closed; naming a non-main branch explicitly, git push origin <branch>, needs no approval)"; fi
fi
# (d) the gh arms are judged even when an allowed git push sits in the same command.
if [ -n "$reason" ]; then :
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+pr${GHF}[[:space:]]+merge([^[:alnum:]_-]|\$)"; then
  reason="gh pr merge"
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+pr${GHF}[[:space:]]+reopen([^[:alnum:]_-]|\$)"; then
  reason="gh pr reopen (re-fires the PR CI run)"
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+pr${GHF}[[:space:]]+comment([^[:alnum:]_-]|\$)"; then
  reason="gh pr comment (Dependabot rebase/merge triggers fire a CI run)"
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+run${GHF}[[:space:]]+rerun([^[:alnum:]_-]|\$)"; then
  # One exception: inside /fix --ci, ONE
  # ALLOW_PUSH=1 gh run rerun --failed <run-id> per COMPLETED run while its attempt reads 1. The guard
  # cannot see attempt or context, so it still denies; the deny text names the one covered form.
  _pg_tail_pre="Outside that one /fix --ci exception: "
  reason="gh run rerun (one exception: inside /fix --ci, ONE ALLOW_PUSH=1 gh run rerun --failed <run-id> per completed run while gh run view <run-id> --json attempt -q .attempt reads 1; any other rerun needs the owner's go)"
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+workflow${GHF}[[:space:]]+run([^[:alnum:]_-]|\$)"; then
  reason="gh workflow run"
elif echo "$cmd" | grep -qE "${POS}gh${GHF}[[:space:]]+(pr[[:space:]]+update-branch|workflow[[:space:]]+enable|alias[[:space:]]+(set|import))([^[:alnum:]_-]|\$)"; then
  reason="gh pr update-branch / workflow enable / alias set (fires CI, or renames a gated verb)"
elif echo "$cmd" | grep -qiE "${POS}curl[[:space:]][^;&|]*api\.github\.com" \
     && echo "$cmd" | grep -qE "curl[^;&|]*[[:space:]](-[[:alpha:]]*X[[:space:]]*[\"']?(PUT|POST|PATCH|DELETE)|--request|-[[:alpha:]]*[dFT]|--data|--data-[a-z]+|--form|--json|--upload-file)"; then
  reason="curl write to api.github.com (the gh api gate, reached without gh)"
elif echo "$cmd" | grep -qE "${POS}gh[[:space:]]+api([^[:alnum:]_-]|\$)"; then
  # (e) INVERTED: every non-GET `gh api` denies (no in-repo caller writes through gh api — measured),
  # except a graphql call whose inline query is a read. Quotes are stripped before parsing, the LAST
  # -X/--method wins (pflag), attached -fk=v counts as a field, and a substituted method denies.
  api_hit=""; api_n=0
  while IFS= read -r api_seg; do
    [ -n "$api_seg" ] || continue
    api_n=$((api_n+1))
    [ "$api_n" -gt 100 ] && { api_hit="CAP"; break; }   # bounded, like the push loop: a timed-out hook is an ALLOW
    s="$(_pg_unquote "$api_seg")"
    case "$s" in *%UNBALANCED%*) api_hit="UNPARSED"; break ;; esac   # a quote left open at end of line hides the rest of the call
    api_method="GET"
    if printf '%s' "$s" | grep -qE '[[:space:]](-i*[fF]|--field|--raw-field|--input)'; then api_method="POST"; fi
    api_m="$(printf '%s' "$s" | grep -oE '[[:space:]](-i*X|--method)[[:space:]=]*[^[:space:]]+' | tail -1 | sed -E 's/^[[:space:]]*(-i*X|--method)[[:space:]=]*//' | tr '[:lower:]' '[:upper:]')"
    [ -n "$api_m" ] && api_method="$api_m"
    [ "$api_method" = "GET" ] && continue
    if [ -z "$api_m" ] && printf '%s' "$s" | grep -qE 'gh[[:space:]]+api[[:space:]]+graphql([[:space:]]|$)' \
       && ! printf '%s' "$s" | grep -qiE '\bmutation\b|--input|-[fF][[:space:]]*[A-Za-z_]*=@|[$`]' \
       && printf '%s' "$s" | grep -qE '(-f|-F|--field|--raw-field)[[:space:]]*query=[[:space:]]*(query|\{)'; then
      continue
    fi
    api_hit="${api_method//[^A-Za-z]/_}"; break   # the method is command text: keep the deny JSON valid
  done <<< "$(printf '%s' "$cmd" | grep -oE "${POS}gh[[:space:]]+api(${_QW}*)")"
  if [ "$api_hit" = "CAP" ]; then reason="gh api (more than 100 gh api calls in one command — too many to classify inside the hook's time budget, fail-closed; split the command)"
  elif [ "$api_hit" = "UNPARSED" ]; then reason="gh api (a quote left open in the call hides its method and endpoint — could not classify, fail-closed; close the quote)"
  elif [ -n "$api_hit" ]; then reason="gh api $api_hit (a write through the API; only GET reads and graphql read queries pass)"; fi
fi

if [[ -n "$reason" ]]; then
  # FIRES LOG — this gate is DENY-mode and wrote no record, so its per-incident TP/FP rate was
  # uncalibratable BY CONSTRUCTION (session-cadence.md § READING A GUARD'S FIRES). Same defect
  # fixed at bash-safety-warn.sh on 2026-08-13; that commit swept no siblings.
  # Best-effort; never fail the hook on a logging problem. Writes NOTHING to stdout — the
  # harness discards a hook's stdout wholesale unless it is exactly one JSON document.
  if [ "${PUSH_GUARD_NO_LOG:-0}" != "1" ]; then
    _pg_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
    mkdir -p "$_pg_dir" 2>/dev/null
    _pg_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
    printf '{"ts":"%s","arm":%s,"cmd":%s}\n' "$_pg_ts" \
      "$(printf '%s' "$reason" | head -c 90 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
      "$(printf '%s' "$cmd" | head -c 400 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
      >> "$_pg_dir/push-guard-fires.jsonl" 2>/dev/null
  fi
  cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED by block-push-without-approval.sh: '$reason' can reach PRODUCTION (main) or triggers a CI run (a long, billable run), and this is a HARD RULE: no production push, merge or CI-trigger without explicit per-action approval. Under the branching policy a push to dev or a feature branch and opening a PR pass without approval; the MERGE into main and any push that targets main do not.\n\nDo NOT silently bypass. ${_pg_tail_pre}Ask the owner to approve THIS specific push/action first. ONLY after they say go, re-run with an 'ALLOW_PUSH=1 ' prefix (e.g. 'ALLOW_PUSH=1 gh pr merge --merge <n>'). For anything that reaches main the go is narrow: a promote merge needs the owner's explicit merge approval for the exact head sha (/promote step 5) or the owner's advance go bound to that head with every one of /promote iron rule 1b's conditions clean, and a direct push needs the owner's yes to /push step 0's named EMERGENCY question for that sha; a bare push approval on a hotfix routes to /promote. Batch changes into ONE push. Local commits + free local verification (tsc/npm test/test:integration) need no approval."
  }
}
JSON
  exit 2
fi

exit 0
