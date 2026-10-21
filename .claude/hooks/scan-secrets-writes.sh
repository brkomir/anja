#!/usr/bin/env bash
# PostToolUse hook — scan newly-written file for secret patterns.
#
# v2.8.0 top-priority adoption — the pattern was adopted from vinicius91carvalho's Claude Code
# system, public under the MIT License when adopted (see .claude/NOTICE).
# Complements existing validate-no-secrets.sh (which scans git-staged files
# post-commit-Bash) by catching secrets at Write/Edit time — BEFORE any git
# operation. Earlier detection = smaller blast radius.
#
# MODE: WARN-ONLY (exit 0). Flip to BLOCK (exit 2) after 1 session confirms
# low false-positive rate. Companion hook: none yet; flip via editing this
# script's exit code.
#
# Patterns detected:
#   - Anthropic:    sk-ant-[a-zA-Z0-9_-]{40,}
#   - OpenAI-style: sk-[a-zA-Z0-9]{40,}  (but not sk-ant-)
#   - AWS:          AKIA[A-Z0-9]{16}
#   - GitHub PAT:   ghp_[a-zA-Z0-9]{36,}
#   - Paddle live:  the live API-key prefix, then [a-zA-Z0-9]{20,}
#   - Private key:  -----BEGIN (RSA|EC|OPENSSH|DSA)? PRIVATE KEY-----
#
# Skipped paths (false-positive reduction):
#   - *.env.example / *.env.sample / *.env.template (placeholder values)
#   - tests/** (mock tokens, fixture keys)
#   - *.md (docs that reference patterns as examples)
#   - .claude/** (meta docs reference actual key *formats*)
#   - node_modules, .next (not ours)

set -u

# Model-aimed advisory on PostToolUse. Measured 2026-08-25 in a throwaway rig: bare stderr
# delivers ZERO text to the model on this event; hookSpecificOutput.additionalContext is
# quoted back verbatim. WARN_EMIT_EVENT is REQUIRED — the lib defaults to PreToolUse, which
# is wrong here and would misroute the payload (caught on the first conversion).
# Fallback FIRST, errexit suspended across the source: `.` is a POSIX special builtin, so a
# failed source under `set -e` is FATAL and `|| true` cannot rescue it.
WARN_EMIT_EVENT=PostToolUse
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

payload=$(cat 2>/dev/null || echo "{}")
file_path=$(echo "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [[ -z "${file_path:-}" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# ⛔ SCANNED DESPITE THE `*.md` AND `*/.claude/*` SKIPS BELOW. The credential-REFERENCE docs are
# the files most likely to receive a pasted credential, and under those skips alone they would be
# the one class the write-path scanner cannot see. The licence to un-skip them is a measurement:
# when every postgres URL across the reference docs carries a placeholder password, the interior
# tightening below makes this class cost no false positives. That measurement is the whole
# licence, so re-take it before widening the class; a reference doc that legitimately needs a
# literal secret belongs in the env-example family, not here.
#
# ⛔ MATCHED ON BOTH THE RAW **AND** THE RESOLVED PATH, AND THAT IS THE WHOLE FIX. One string
# pattern tested against an unnormalized path is not enough: a write that arrives through an
# aliased spelling of the same file (a symlinked directory whose segment differs from the one
# the arm names) can miss the arm and fall through to `*/.claude/*) exit 0`, so one inode with
# one content could get two verdicts, firing through one spelling and silent through the
# other. Testing the resolved path as well means every spelling of the file reaches the same
# verdict, whichever one the write arrives under.
# The general form is to contain a path by RESOLVED-ancestor walk, never by string
# prefix; this is that rule at the un-skip surface.
# BSD has no `readlink -f`, so the directory is resolved with `cd … && pwd -P` — no python
# call on a hook that fires on every write. Checked as a UNION of both spellings, so an alias
# can only ADD scanning and never remove it; if resolution fails the raw path still decides.
_fp_dir="$(cd "$(dirname "$file_path")" 2>/dev/null && pwd -P || true)"
_fp_real="$file_path"
[ -n "$_fp_dir" ] && _fp_real="$_fp_dir/$(basename "$file_path")"
_is_credential_reference_doc() {
  case "$1" in */.claude/project-memory/reference_*.md) return 0 ;; esac
  return 1
}
if ! _is_credential_reference_doc "$file_path" && ! _is_credential_reference_doc "$_fp_real"; then
# Skip paths where secret patterns are legitimate content.
case "$file_path" in
  *.env.example|*.env.sample|*.env.template|*.env.local.example) exit 0 ;;
  *tests/*) exit 0 ;;
  *.md) exit 0 ;;
  */.claude/*) exit 0 ;;
  *node_modules/*) exit 0 ;;
  *.next/*) exit 0 ;;
esac
fi   # ← closes the credential-reference-doc un-skip guard above
# Run ledger (2026-10-09): ONE row per SCANNED write, clean included, in scan-secrets-writes-fires.jsonl;
# the shared match ledger (secret-scan-fires.jsonl) stays as it was. Same HOOK_SMOKE_EXEC refusal as that ledger.
_w1_fire() { local _r=$?; [ "${HOOK_SMOKE_EXEC:-0}" != 1 ] || [ -n "${HOOK_FIRES_LOG_DIR:-}" ] || return 0; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${payload:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log scan-secrets-writes sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "$([ -n "${matches:-}" ] && echo found || echo clean)" rc "$_r" ) >/dev/null 2>&1 || true; }; trap _w1_fire EXIT

matches=""

if grep -qE 'sk-ant-[a-zA-Z0-9_-]{40,}' "$file_path" 2>/dev/null; then
  matches+="  - Anthropic API key (sk-ant-...)\n"
fi

# OpenAI-style: sk- but NOT sk-ant-
if grep -qE '(^|[^a-zA-Z0-9_-])sk-[a-zA-Z0-9]{40,}' "$file_path" 2>/dev/null && \
   ! grep -qE 'sk-ant-' "$file_path" 2>/dev/null; then
  matches+="  - OpenAI-style API key (sk-...)\n"
fi

if grep -qE 'AKIA[A-Z0-9]{16}' "$file_path" 2>/dev/null; then
  matches+="  - AWS access key (AKIA...)\n"
fi

if grep -qE 'ghp_[a-zA-Z0-9]{36,}' "$file_path" 2>/dev/null; then
  matches+="  - GitHub PAT (ghp_...)\n"
fi

if grep -qE 'pdl_live_''apikey_[a-zA-Z0-9]{20,}' "$file_path" 2>/dev/null; then
  matches+="  - Paddle live API key (pdl_live_...)\n"
fi

# ⛔ TWO ARMS THAT MIRROR THE COMMIT PATH'S, so the write path and the commit path carry the
# same key shapes rather than disjoint halves. Neither arm costs a false positive unless the
# tree holds a literal of either shape.
#   sk-proj-  : the generic `sk-[a-zA-Z0-9]{40,}` arm above CANNOT reach an OpenAI project
#               key — a real one reads `sk-proj-<...>` and the `-` at offset 5 breaks the
#               alnum run, so the arm fails on the very key class it looks like it covers.
#   pdl_ntfset_: the payment provider's WEBHOOK SIGNING SECRET. api-routes.md records it as
#               a high-cost config secret — a wrong one fails only at runtime, on a real
#               delivery.
# Each shape keeps a fixture on THIS path as well as on the commit path: a fixture that
# lives only in the smoke suite's COMMIT-path block cannot witness a missing write-path
# arm, so a gap between the two scanners would stay invisible to every write-path test
# (tests-unit.md, fixture family).
if grep -qE 'sk-proj-[a-zA-Z0-9_-]{20,}' "$file_path" 2>/dev/null; then
  matches+="  - OpenAI project API key (sk-proj-...)\n"
fi

if grep -qE 'pdl_ntfset_[a-zA-Z0-9]{20,}' "$file_path" 2>/dev/null; then
  matches+="  - Paddle webhook signing secret (pdl_ntfset_...)\n"
fi

if grep -qE -- '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' "$file_path" 2>/dev/null; then
  matches+="  - Private key header\n"
fi

# postgres URL WITH an inline password — a credential class that leaks in practice. The
# COMMIT-path scanner (validate-no-secrets) carries it and so does the WRITE path here, so a
# connection string written into a file is scanned at write time, before any commit.
#
# ⛔ THE PASSWORD MUST BE STRUCTURALLY CAPABLE OF BEING ONE. The bare regex matched a
# PLACEHOLDER as readily as a credential, which is why the database reference doc could not be
# un-skipped: it holds a postgres URL with a placeholder password, so scanning it bought a
# PERMANENT false positive on a known-good doc. Both other remedies are measured-refuted:
# narrowing the `.md` skip alone fires forever, and
# exempting a line that carries a redaction MARKER is the self-disabling shape — the suppressor
# becomes file CONTENT, so anything that can write a file can silence the scanner.
# This is a precision fix to the PATTERN, not a content-keyed suppressor.
#
# ⚠️ SCOPED DELIBERATELY NARROWER THAN THE ORIGINAL REQUEST, and the deviation is the point.
# The request listed `REDACTED` and `PASS` as placeholder forms too. They are NOT excluded here:
# a word is a legal password, so excluding words trades a false positive for a silent false
# NEGATIVE — the one direction this guard must not fail in.
#
# ⛔ THE BRACKETS ARE NOT THE TEST — THE INTERIOR IS. A rule keyed on the brackets alone would
# drop a postgres URL whose password is `[<secret-shaped-password>]` — a REAL password that
# happens to be bracket-WRAPPED — as silently as a placeholder. A fixture set needs the wrapped
# case as well as a bracket INSIDE a password (`a<b>c`, still fires), or it has a hole shaped
# exactly like the failure direction this guard must not fail in.
# So a bracket-delimited password is excluded ONLY when its INTERIOR reads as a placeholder
# word — letters, spaces, dots, dashes, underscores. Anything carrying digits or symbols
# (i.e. anything that looks like an actual secret) FIRES.
#   · `<password>` `{YOUR_PASSWORD}` `[db pass]` → placeholder interior → silent
#   · `[<secret-shaped-password>]`               → secret-shaped interior → FIRES
#   · ALL-ASTERISK (`***`)                       → a mask, not a secret  → silent
# `$VAR` is likewise NOT excluded, though it is a common docs idiom: a real password may
# begin with `$`. Fixture table proving each of these still FIRES: smoke-test-hooks.sh.
#
# ⚠️ THE FIRST CUT'S STATED REASON WAS FACTUALLY WRONG: it said
# `<>{}[]` are "RFC 3986 gen-delims". They are not — gen-delims are `:/?#[]@`. What IS true
# is that none of `<>{}` appears in ANY production for a userinfo component (RFC 3986
# §3.2.1 = unreserved / pct-encoded / sub-delims / `:`), and `[`/`]` are gen-delims excluded
# from it, so all six must be percent-encoded there. The conclusion survived; the reason
# did not, and the wrong reason had already been asserted in a commit, a mail and a row.
# ⛔ THE PREDICATE NOW LIVES IN A SHARED LIB — do NOT re-inline it here. The identical logic was
# hand-copied into validate-no-secrets.sh and DRIFTED: this path gained a placeholder-interior
# test and the commit path did not, so one rejected placeholder passwords and the other fired on
# them. Both now source one file, which is the only arrangement that cannot drift.
# FAIL-SAFE: if the lib does not resolve, the fallback FIRES on any postgres URL carrying an
# inline password. A secret scanner must never go silent on its own breakage, so the fallback is
# deliberately COARSER than the real predicate, not absent. It must stay a SUPERSET of BOTH lib
# shapes (userinfo + ?password=, any case, +dialect, empty user, `/` in the password): a
# narrower fallback would go silent on exactly the shapes the lib is widened to catch.
_pg_has_real_password() {
  grep -qiE 'postgres(ql)?(\+[[:alnum:]_]+)?://[^[:space:]:@/]*:[^[:space:]@]+@|postgres(ql)?(\+[[:alnum:]_]+)?://[^[:space:]]*[?&]password=' "$1" 2>/dev/null
}
. "$(dirname "${BASH_SOURCE[0]}")/lib/pg-secret.sh" 2>/dev/null \
  && _pg_has_real_password() { pg_url_has_real_password "$1"; }
if _pg_has_real_password "$file_path"; then
  matches+="  - postgres URL with inline password (password in the URL userinfo or a ?password= query)\n"
fi

# PGPASSWORD — the SECOND carrier of the same secret, and the arm above is structurally blind to
# it: that one matches a URI (a postgres URL with the password in its userinfo), this is an
# ENV ASSIGNMENT with no URI around it. Both carriers are live in this repo, and an `=`-anchored arm sees only the first:
#   · PGPASSWORD=${DB_PASS} psql …   shell assignment   scripts/integration-test.sh, e2e-local.sh
#   · PGPASSWORD: test               YAML mapping       a CI workflow file
# so this matches `=` OR `:`. `.yml` is on no skip list, so that file IS scanned.
#
# ⚠️ DELIBERATE DEVIATION from _pg_has_real_password's doctrine directly above, stated because it
# is a real asymmetry and not an oversight. That arm fires on a bare-WORD password on the ground
# that "a word is a legal password", preferring a false positive to a silent false negative.
# Applied here it fires on `PGPASSWORD: test` — THREE permanent false positives on a CI
# service-container fixture, which is the permanent-false-positive class.
# The carriers differ in kind: a postgres URL with an inline password is already
# credential-shaped, whereas PGPASSWORD's dominant legitimate use is a throwaway CI word.
# So this arm requires a SECRET-SHAPED value — contains a digit, does not begin $ < { or *.
# ⛔ NAMED FALSE NEGATIVE: an all-letters password with no digit (`PGPASSWORD=correcthorse`) is
# MISSED. That is the price of the deviation, recorded here rather than discovered later.
# Measured 2026-08-25: 0 hits across all three live carrier files; 1 on a copy of the CI workflow
# file with a real secret planted (the discriminating control — same file, opposite reading).
if grep -qE "PGPASSWORD[[:space:]]*[=:][[:space:]]*['\"]?[^[:space:]'\"\$<{*]*[0-9][^[:space:]'\"]*" "$file_path" 2>/dev/null; then
  matches+="  - PGPASSWORD with an inline value (PGPASSWORD=... / PGPASSWORD: ...)\n"
fi

# Supabase service-role JWT + Resend key — union with the commit-path scanner (validate-no-secrets),
# so the two scanners cover the same secret inventory rather than disjoint halves.
# ⚠️ A COMMENT ASSERTING THE UNION IS NOT EVIDENCE OF IT — a sentence like the one above can
# stop anyone checking while one scanner lacks a shape the other carries. Verify the union
# by ENUMERATING both arm sets from source (the write path's `matches+=` lines vs the commit
# path's SECRET_RE members) rather than trusting this comment or a literal grep — a literal
# grep for the webhook-secret prefix returns 0 against the commit path, whose arm folds both
# vendor prefixes into one alternation, so a literal grep can read a covered shape as a gap
# and send the search for a real gap the wrong way.
if grep -qE 'SUPABASE_SERVICE_ROLE_KEY' "$file_path" 2>/dev/null; then
  matches+="  - Supabase service-role key\n"
fi
if grep -qE '(^|[^a-zA-Z0-9_])re_[a-zA-Z0-9]{20,}' "$file_path" 2>/dev/null; then
  matches+="  - Resend API key (re_...)\n"
fi

if [[ -n "$matches" ]]; then
  # ⛔ TARGETED \n-ONLY SUBSTITUTION, NOT AN ESCAPE INTERPRETER, AND IT MUST HAPPEN HERE
  # RATHER THAN IN THE HEREDOC: a heredoc does not process ANSI-C $'...' quoting, so the
  # in-body form rendered the replacement literally as $'\n'. Measured — a live run showed
  # it on the model channel, which no smoke arm did, because the arms
  # assert PRESENCE of the advisory and this defect is inside it.
  # WHY NOT printf %b: %b interprets the WHOLE variable and honours \c, which STOPS ALL
  # OUTPUT — on a warn-only security hook the message IS the product, so a message
  # truncatable by its own subject matter would be the defect.
  # ⚠️ NOT reachable today, checked rather than assumed: all 12 matches+= sites are FIXED
  # literals, none interpolates anything, so no scanned byte enters this variable (the
  # review that raised it believed otherwise — measured false). file_path IS
  # attacker-influenced but a heredoc does not interpret escapes in an expansion,
  # verified with a backslash-c filename. Fixed on SHAPE: escape interpretation belongs
  # to the TEMPLATE, never to a variable.
  _matches_rendered="${matches//\\n/$'\n'}"
  warn_emit <<EOF || true

🔒 SECRET WARNING (scan-secrets-writes.sh — WARN-ONLY, v2.8.0):
   File: $file_path
   Matches:
$_matches_rendered
   Action: remove secret, use process.env.<NAME> instead.
   Mode: warn-only — PERMANENTLY. Block mode is never safe for this hook.
   Why: 3 of the 5 write-path files CANNOT be correct without the pattern — incl. this hook's
   own FIRE fixture in smoke-test-hooks.sh (block mode = you cannot edit the test that proves
   the scanner works). Use-class necessity, not mention-class edge cases. Fires ledger:
   .claude/logs/secret-scan-fires.jsonl (both scanners) — it feeds use-vs-mention fire
   classification and demotion arguments; block-mode promotion stays never safe.

EOF
  # FIRES LEDGER — deliberately AFTER the advisory: the instrument cannot precede
  # the product — a PROPERTY, not a per-command claim. Instrumentation only; the subshell
  # redirect keeps a failed open's stderr off the terminal ahead of the advisory.
  # HOOK_SMOKE_EXEC guard: the suite's env -i arms scrub the
  # SECRET_SCAN_FIRES_LOG export but deliberately PRESERVE HOOK_SMOKE_EXEC — refusing the
  # write there makes no-contamination a MECHANISM; an explicit override stays honored
  # (the redirect IS the test seam).
  if [ "${HOOK_SMOKE_EXEC:-0}" != "1" ] || [ -n "${SECRET_SCAN_FIRES_LOG:-}" ]; then
    # Root via the COMMON dir: an agent-worktree fire must land in the ONE ledger — a
    # worktree-local fragment under-reports, the exact vacuity this record exists to close
    # (2 stray sibling-hook logs measured in live worktrees).
    _ssw_root="${CLAUDE_PROJECT_DIR:-$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)}"
    [ -n "$_ssw_root" ] || _ssw_root="$(pwd)"
    _ssw_log="${SECRET_SCAN_FIRES_LOG:-$_ssw_root/.claude/logs/secret-scan-fires.jsonl}"
    mkdir -p "$(dirname "$_ssw_log")" 2>/dev/null || true
    # ⚠ file_path is logged UNRESOLVED, deliberately — the guarantee arm greps for the raw
    # mktemp path (/var/…, a symlink to /private/var); one realpath here blinds it. It IS
    # JSON-escaped, backslash FIRST — the unescaped form logged VALID JSON whose file field
    # was a silently different path (\b became a backspace). "arm" = first match
    # line, for use-vs-mention classification (session-cadence: the ledger needs the split).
    _j="${file_path//\\/\\\\}"; _j="${_j//\"/\\\"}"; _j="${_j//$'\n'/\\n}"
    _j="${_j//$'\t'/\\t}"; _j="${_j//$'\r'/\\r}"; _j="${_j//[[:cntrl:]]/?}"
    _ja=${matches%%'\n'*}; _ja=${_ja%%$'\n'*}; _ja="${_ja:0:48}"
    _ja="${_ja//\\/\\\\}"; _ja="${_ja//\"/\\\"}"; _ja="${_ja//[[:cntrl:]]/?}"
    ( printf '{"ts":"%s","hook":"scan-secrets-writes","arm":"%s","file":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_ja" "$_j" >> "$_ssw_log" ) 2>/dev/null || true
  fi
fi

exit 0
