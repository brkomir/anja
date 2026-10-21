#!/usr/bin/env bash
# Shared postgres-URL secret predicate — sourced by BOTH secret scanners.
#
# WHY A SHARED FILE. The identical regex was hand-copied into scan-secrets-writes.sh (a
# standalone arm) and validate-no-secrets.sh (inline in a monolithic SECRET_RE), and they
# DRIFTED: the write path gained a placeholder-interior test on 2026-08-25 and the commit path
# did not, so one rejected placeholder passwords and the other still fired on them. This file
# is the remedy. Hand-copied logic drifts: every copy is one more place a fix can miss, so a
# predicate two scanners share lives in one file they both source.
#
# ⛔ THE COMMIT PATH CANNOT USE A REGEX FOR THIS. Its SECRET_RE is one alternation consumed by a
# single `grep -qE`, which cannot report WHICH branch matched, and POSIX ERE has no negative
# lookahead — so "postgres URL, but not a placeholder, but not loopback" is not expressible
# there. It has to be a per-hit function, which is what this is.
#
# CONTRACT: pg_url_has_real_password <file>  ->  rc 0 if the file carries a postgres URL whose
# inline password looks REAL, rc 1 otherwise. FAIL-SAFE DIRECTION IS rc 0 (fire): a secret
# scanner that goes silent on its own breakage is the one failure it must not have.

# _pg_pw_is_real <password> <host>  ->  rc 0 iff the password reads REAL at a non-loopback host.
# ONE judgement for both URL shapes below (userinfo and query), so the two cannot drift apart —
# the same drift this file was created to end between the two scanners.
_pg_pw_is_real() {
  local pw="$1" _pg_host="$2" _pgi _pgn

  # ---- LOOPBACK EXEMPTION ---------------------------------------------------------------
  # ⛔ ADOPTED ON THE MEASUREMENT, NOT ON A PRINCIPLE, and the distinction is load-bearing.
  # "loopback has nothing to exfiltrate" is FALSE as doctrine: a loopback host voids the
  # connection TARGET and says NOTHING about the PASSWORD MATERIAL under reuse. A
  # fresh-context calibrator declined to endorse that framing and was right to.
  # What licenses it HERE is corpus-specific: every loopback occurrence in this repo is a
  # machine-created throwaway (`DB_PASS="test"` at scripts/integration-test.sh:17, fed to
  # POSTGRES_PASSWORD, so the database is CREATED with it). In a repo with human-chosen
  # local passwords this exemption would be WRONG — do not port it as a rule.
  # ⛔ ACCEPTED RESIDUAL: a REAL password typed at a loopback host goes
  # unflagged. That is the trade, not an oversight.
  # The "87% quieter" objection that killed the earlier proposal was computed over corpus
  # FILE COUNT — a denominator nobody experiences, because the write hook reads ONE file per
  # call and the commit hook reads the staged set. Measured over 1000 commits: the arm fires
  # on 389 and still fires on 380 under this exemption = 3.8% quieter.
  # The HOST arrives from the caller: each URL shape locates it differently.
  case "$_pg_host" in
    localhost|127.0.0.1|0.0.0.0|::1|'[::1]') return 1 ;;
  esac

  # ---- PLACEHOLDER INTERIOR -------------------------------------------------------------
  # ⛔ THE BRACKETS ARE NOT THE TEST — THE INTERIOR IS. `<scheme>://user:[<real-password>]@host`
  # is a REAL password that happens to be bracket-WRAPPED, and a test on the brackets alone drops it
  # silently. A bracket-delimited password is exempt ONLY when its interior reads as a
  # placeholder WORD; anything carrying a digit or symbol FIRES.
  # A bare WORD is NOT exempt: a word is a legal password, and excluding words trades a false
  # positive for a silent false NEGATIVE — the one direction this guard must not fail in.
  # ⛔ A CHARACTER CLASS IS THE WRONG TEST. An arm that exempts anything drawn from letters,
  # spaces, dots and dashes has no length, entropy or vocabulary bound, so it would exempt a
  # long bracket-wrapped passphrase: a real credential, and a strong one. "Reads as a
  # placeholder WORD" is a vocabulary question, and a comment that names the right predicate
  # does not make the code implement it: check the code against the real function.
  # Pair every exemption test here with a firing control (a mixed-case password with digits
  # at a remote host must FIRE), or a silent result proves nothing about the exemption.
  # THE TEST IS AN EXACT-MATCH VOCABULARY. Normalize (lowercase, drop _ . - and spaces), then exempt
  # ONLY a known redaction WORD. Strictly narrower than the character class, so it cannot
  # introduce a new false negative, and it fails LOUD — this guard's stated direction.
  # ADDING A WORD HERE WIDENS A SECURITY EXEMPTION: it must be a word no human would choose
  # as a password, never merely one seen in this repo.
  case "$pw" in
    '<'*'>' | '{'*'}' | '['*']' )
      _pgi=${pw#?}; _pgi=${_pgi%?}
      _pgn=${_pgi//[_. -]/}
      _pgn=$(printf '%s' "$_pgn" | tr 'A-Z' 'a-z')
      case "$_pgn" in
        '' ) : ;;
        password|passwd|pass|pw|pwd|secret|redacted|redact|placeholder|changeme \
        |yourpassword|yourpass|mypassword|dbpassword|testpassword|examplepassword \
        |notarealpw|notarealpassword|xxx|xxxx|xxxxx|xxxxxx )
          return 1 ;;               # a known redaction WORD -> exempt
        * ) : ;;                    # anything else in brackets is a REAL credential -> FIRE
      esac
      ;;
  esac
  # ALL-ASTERISK (`***`) is a mask, not a secret.
  case "$pw" in *[!*]* ) ;; * ) return 1 ;; esac
  return 0
}

pg_url_has_real_password() {
  local f="$1" hits u pw _pgh _pg_s _pg_nq _pg_ui _pg_qr
  [ -f "$f" ] || return 1
  # ---- THE TWO SHAPES -------------------------------------------------------------------
  # ⛔ THE OLD USERINFO PATTERN PLUS FIVE SHAPES. The old pattern,
  # `postgres(ql)?://[^[:space:]:@/]+:[^[:space:]@/]+@…`, is the base; the pattern below also
  # covers these five credential shapes, each by its own part and each a FIRE arm in
  # scripts/smoke-test-hooks.sh:
  #   UPPERCASE scheme `POSTGRESQL://`        -> grep -i
  #   DIALECT scheme `postgresql+psycopg2://` -> the optional `+word` group in _pg_s
  #   EMPTY USER `<scheme>://:pw@host`        -> the user class is `*`, not `+`
  #   A `/` IN THE PASSWORD                   -> the second password alternative
  #   QUERY FORM `…/db?password=pw`           -> the separate _pg_qr pattern
  # The OLD password class is kept as the FIRST alternative, unchanged, so every URL the old
  # pattern matched still matches (no new silent miss). The slash-bearing alternative also
  # stops at a quote: without that, a credential-less `"<scheme>://h:5432/db","to":"a@b.c"`
  # would read `5432/db","to":"a` as a password. ACCEPTED RESIDUALS: a slash-bearing password
  # that ALSO contains a quote character is still silent; and a credential-less
  # `scheme://host:PORT/path@…` with no space or quote before the `@` FIRES (port read as a
  # password) — the fail-loud direction. Measured over every tracked file mentioning postgres
  # (977) at the widening: 15 fired before and after, 0 went silent, 1 newly fired —
  # scripts/lib/db-url.mjs, whose comment quotes the slash shape as an example.
  # Plain `grep` here is /usr/bin/grep (BSD; GNU on CI) — the zsh ugrep shim does not cross a
  # bash shebang. Both read POSIX ERE with -o -i -E.
  _pg_s='postgres(ql)?(\+[[:alnum:]_]+)?://'
  _pg_nq="[:space:]\"'\`"
  _pg_ui="${_pg_s}[^[:space:]:@/]*:([^[:space:]@/]+|[^${_pg_nq}@/]*/[^${_pg_nq}@]*)@[^[:space:]/\"']*"
  _pg_qr="${_pg_s}[^${_pg_nq}?]*\\?([^${_pg_nq}#]*&)?password=[^${_pg_nq}&#]+"

  # -- userinfo shape: scheme://user:PASS@host --
  # ⛔ THE MATCH MUST REACH PAST THE `@` — the loopback arm needs the HOST, and the original
  # pattern stopped AT the `@` so the host was never captured. Widening changes nothing about
  # WHICH urls match (both password alternatives exclude `@`), only what this can read.
  # `|| hits=`: a no-match grep must not end the function under a caller's `set -e` before the
  # query shape below is checked, or a query-only file would never reach that check.
  hits=$(grep -oiE "$_pg_ui" "$f" 2>/dev/null) || hits=
  if [ -n "$hits" ]; then
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      # ⛔ LENGTH CAP, BOTH LOOPS. The host strips (`##*@`, `%%:*`) are quadratic in bash 3.2 on a
      # long hit: a 100 KB host took ~50 s here, a 100 KB query-form prefix ~36 s, and this runs
      # after every Bash call on every staged file. No real connection string is near 2 KB
      # (tracked-corpus max: 97 chars), so an over-long hit FIRES — the loud direction.
      [ "${#u}" -le 2048 ] || return 0
      # everything after the FIRST user-colon, minus the trailing @host — colon-safe, because a
      # real password may contain colons and a suffix-strip would test only its tail. The
      # scheme is stripped by shape, not by spelling, so `POSTGRESQL+psycopg2://` strips too.
      pw=$(printf '%s' "$u" | sed -E 's|^[^:/]*://[^:]*:||; s|@[^@]*$||')
      _pgh="${u##*@}"; _pgh="${_pgh%%:*}"; _pgh="${_pgh%%/*}"
      _pg_pw_is_real "$pw" "$_pgh" && return 0
    done <<< "$hits"
  fi

  # -- query shape: scheme://host/db?…password=PASS --
  hits=$(grep -oiE "$_pg_qr" "$f" 2>/dev/null)
  if [ -n "$hits" ]; then
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      [ "${#u}" -le 2048 ] || return 0      # the length cap above, for the same strips
      pw="${u##*[?&][Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]=}"
      _pgh="${u#*://}"; _pgh="${_pgh%%[/?]*}"; _pgh="${_pgh##*@}"; _pgh="${_pgh%%:*}"
      _pg_pw_is_real "$pw" "$_pgh" && return 0
    done <<< "$hits"
  fi
  return 1
}
