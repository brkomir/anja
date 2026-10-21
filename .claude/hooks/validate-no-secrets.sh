#!/bin/bash
# Post-tool-use hook: scan for accidentally committed secrets
# Checks staged files for common secret patterns

# PGPASSWORD arm. The postgres arm above
# matches a URI (a postgres URL with an inline password in its userinfo); `PGPASSWORD` is an ENV ASSIGNMENT with no URI
# around it, so a URI arm cannot see it on either scanner — and an idiom a repo already uses for
# throwaway values is exactly the one likely to be copied into a file holding a real password.
# TWO CARRIERS, and an `=`-anchored arm is blind to the second:
#   · PGPASSWORD=${DB_PASS} psql …   shell assignment  scripts/integration-test.sh, e2e-local.sh
#   · PGPASSWORD: test               YAML mapping
# ⚠️ DELIBERATE DEVIATION FROM THE postgres ARM'S DOCTRINE, stated because it is a real
# asymmetry and not an oversight. That arm fires on a bare-WORD password on the stated ground
# that "a word is a legal password", accepting a false positive over a silent false negative.
# Applying that here fires on `PGPASSWORD: test` — permanent false positives on a CI
# service-container fixture, a known defect class for secret hooks. The difference is the carrier:
# a postgres URL with an inline password is already credential-shaped, whereas PGPASSWORD's
# dominant legitimate use is a throwaway CI word. So this arm requires a SECRET-SHAPED value —
# one containing a digit — and skips a value that begins with $ < { or *.
# ⛔ THE NAMED FALSE NEGATIVE: an all-letters password with no digit (`PGPASSWORD=correcthorse`)
# is MISSED. That is the cost of the deviation; it is stated here rather than discovered later.
# Fixture table (4 fire / 7 silent, incl. both live carriers) in scripts/smoke-test-hooks.sh.
SECRET_RE="(SUPABASE_SERVICE_ROLE_KEY|sk-ant-[a-zA-Z0-9_-]{40,}|sk-proj-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{40,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36,}|pdl_(live_apikey|ntfset)_[a-zA-Z0-9]{20,}|re_[a-zA-Z0-9]{20,}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY|PGPASSWORD[[:space:]]*[=:][[:space:]]*['\"]?[^[:space:]'\"$<{*]*[0-9][^[:space:]'\"]*)"

# ⛔ THE POSTGRES ARM IS NO LONGER IN SECRET_RE, AND IT CANNOT BE. The exemptions it now carries
# — placeholder-interior, loopback host — are not expressible in one alternation consumed by a
# single `grep -qE`: that cannot report WHICH branch matched, and POSIX ERE has no negative
# lookahead. It is a per-hit function, shared with scan-secrets-writes.sh so the two cannot
# drift again (they already did once: this path kept firing on placeholder passwords for a day
# after the write path stopped).
# FAIL-SAFE: no lib -> fire on any postgres URL with an inline password. Coarser, never silent:
# a SUPERSET of both lib shapes (userinfo + ?password=), kept in step with scan-secrets-writes.sh.
pg_url_has_real_password() {
  grep -qiE 'postgres(ql)?(\+[[:alnum:]_]+)?://[^[:space:]:@/]*:[^[:space:]@]+@|postgres(ql)?(\+[[:alnum:]_]+)?://[^[:space:]]*[?&]password=' "$1" 2>/dev/null
}
. "$(dirname "${BASH_SOURCE[0]}")/lib/pg-secret.sh" 2>/dev/null

FOUND=0
# ⛔ CLEANUP ON ABNORMAL TERMINATION. The loop below materialises the
# STAGED BLOB to a temp file and removes it at the end of each iteration, and NORMAL control
# flow always reaches that `rm`: there is no `exit`/`return`/`continue`/`break` between the
# mktemp and the rm, so a normal run leaves nothing behind.
# The exposure is a SIGNAL landing inside that window, which would leave a file containing
# staged bytes — possibly the secret this hook exists to catch — sitting in TMPDIR.
# What carries the weight is the WIRING, not the width: this hook is event=PostToolUse
# matcher='Bash', so it runs after EVERY Bash tool call, one temp file per staged file each
# time. A narrow window that opens constantly is worth the trap below.
# Single-quoted on purpose: $_vns_blob expands when the trap FIRES, so it names whichever blob
# is in flight rather than an empty value captured at set-up time.
trap 'rm -f "${_vns_blob:-}" 2>/dev/null' EXIT INT TERM HUP
# TWO correctness rules for the loop:
#  (1) Scan the STAGED BLOB (`git show :0:<file>`), NOT the worktree copy. A scanner that greps the
#      worktree file misses a secret that was `git add`-ed and then edited OUT of the worktree (without
#      re-staging): the secret stays staged-and-committable while the scanner reads the clean
#      worktree. `:0:` is the index (stage-0) content — the bytes that will actually commit.
#  (2) NUL-delimited iteration (`-z` + `read -d ''`), NOT `for f in $STAGED`. An unquoted word-split
#      turns a staged filename containing a space into two non-existent paths, both silently skipped.
while IFS= read -r -d '' file; do
  [ -z "$file" ] && continue
  # Read the staged content; skip cleanly if the path has no stage-0 blob (a staged DELETION — no
  # content to leak).
  # Materialise the staged blob once: the postgres predicate takes a FILE (it iterates matches
  # per-hit), and re-running `git show` per check would read the index twice for one question.
  _vns_blob="$(mktemp)"
  git show ":0:$file" > "$_vns_blob" 2>/dev/null
  _vns_via=""
  if grep -qE "$SECRET_RE" "$_vns_blob" 2>/dev/null; then
    _vns_via="secret_re"
  elif pg_url_has_real_password "$_vns_blob"; then
    _vns_via="pg_url"
  fi
  if [ -n "$_vns_via" ]; then
    echo "WARNING: Possible secret in staged file: $file"
    FOUND=1
    # FIRES LEDGER — shared with scan-secrets-writes.sh; instrumentation only, and AFTER the
    # warning (the instrument never precedes the product). "via" names the matching branch —
    # the use-vs-mention discriminator session-cadence.md says every fires ledger needs.
    # HOOK_SMOKE_EXEC guard — same mechanism as scan-secrets-writes.sh: refuse under the
    # suite's env -i arms; an explicit SECRET_SCAN_FIRES_LOG override stays honored.
    if [ "${HOOK_SMOKE_EXEC:-0}" != "1" ] || [ -n "${SECRET_SCAN_FIRES_LOG:-}" ]; then
      # Common-dir root: an agent-worktree fire lands in the ONE ledger, never a fragment.
      _vns_root="${CLAUDE_PROJECT_DIR:-$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)}"
      [ -n "$_vns_root" ] || _vns_root="$(pwd)"
      _vns_log="${SECRET_SCAN_FIRES_LOG:-$_vns_root/.claude/logs/secret-scan-fires.jsonl}"
      mkdir -p "$(dirname "$_vns_log")" 2>/dev/null || true
      # ⚠ $file is logged UNRESOLVED (canonicalising would blind raw-path ledger arms) but
      # JSON-escaped, backslash FIRST — the unescaped form logged VALID JSON whose file field
      # was a silently different path.
      _j="${file//\\/\\\\}"; _j="${_j//\"/\\\"}"; _j="${_j//$'\n'/\\n}"
      _j="${_j//$'\t'/\\t}"; _j="${_j//$'\r'/\\r}"; _j="${_j//[[:cntrl:]]/?}"
      ( printf '{"ts":"%s","hook":"validate-no-secrets","via":"%s","file":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_vns_via" "$_j" >> "$_vns_log" ) 2>/dev/null || true
    fi
  fi
  rm -f "$_vns_blob"
done < <(git diff --cached --name-only -z 2>/dev/null)

if [ "$FOUND" -eq 1 ]; then
  echo "Review staged files for secrets before committing."
fi
# Run ledger (2026-10-09): ONE row per run that scanned >=1 staged file, clean included, in
# validate-no-secrets-fires.jsonl. sid comes from the environment: this hook never reads its payload, so no agent_id/via.
[ -n "${_vns_blob:-}" ] && { [ "${HOOK_SMOKE_EXEC:-0}" != 1 ] || [ -n "${HOOK_FIRES_LOG_DIR:-}" ]; } && ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
  fires_log validate-no-secrets sid "${CLAUDE_CODE_SESSION_ID:-}" outcome "$([ "$FOUND" -eq 1 ] && echo found || echo clean)" ) >/dev/null 2>&1 || true
